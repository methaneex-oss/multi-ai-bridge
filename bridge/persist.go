package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// Snapshot is a portable backup of coordination state (Git remains source of truth for code).
type Snapshot struct {
	Version          int               `json:"version"`
	ExportedAt       time.Time         `json:"exported_at"`
	State            State             `json:"state"`
	Projects         []Project         `json:"projects"`
	Artifacts        []Artifact        `json:"artifacts"`
	EngineeringTasks []EngineeringTask `json:"engineering_tasks"`
	MemoryEntries    []MemoryEntry     `json:"memory_entries"`
	Note             string            `json:"note"`
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	s.mu.RLock()
	st := s.state
	s.mu.RUnlock()

	snap := Snapshot{
		Version:    1,
		ExportedAt: time.Now().UTC(),
		State:      st,
		Note:       "Import via POST /api/v1/import. Does not delete rows absent from the snapshot.",
	}

	rows, err := s.db.Query(`SELECT id, name, description, COALESCE(rules,''), created_at FROM projects ORDER BY created_at`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p Project
			var ts string
			if rows.Scan(&p.ID, &p.Name, &p.Description, &p.Rules, &ts) != nil {
				continue
			}
			p.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			snap.Projects = append(snap.Projects, p)
		}
	}
	if snap.Projects == nil {
		snap.Projects = []Project{}
	}

arows, err := s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts ORDER BY created_at`)
	if err == nil {
		defer arows.Close()
		for arows.Next() {
			var a Artifact
			var ts string
			if arows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Kind, &a.Content, &ts) != nil {
				continue
			}
			a.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			snap.Artifacts = append(snap.Artifacts, a)
		}
	}
	if snap.Artifacts == nil {
		snap.Artifacts = []Artifact{}
	}

trows, err := s.db.Query(`SELECT id, project_id, title, objective, acceptance, owner, status, depends_on, evidence, revision, created_at, updated_at FROM engineering_tasks ORDER BY created_at`)
	if err == nil {
		defer trows.Close()
		for trows.Next() {
			var t EngineeringTask
			var cAt, uAt string
			if trows.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Objective, &t.Acceptance, &t.Owner, &t.Status, &t.DependsOn, &t.Evidence, &t.Revision, &cAt, &uAt) != nil {
				continue
			}
			t.CreatedAt, _ = time.Parse(time.RFC3339, cAt)
			t.UpdatedAt, _ = time.Parse(time.RFC3339, uAt)
			snap.EngineeringTasks = append(snap.EngineeringTasks, t)
		}
	}
	if snap.EngineeringTasks == nil {
		snap.EngineeringTasks = []EngineeringTask{}
	}

mrows, err := s.db.Query(`SELECT id, project_id, kind, content, provenance, confidence, created_at FROM memory_entries ORDER BY created_at`)
	if err == nil {
		defer mrows.Close()
		for mrows.Next() {
			var m MemoryEntry
			var ts string
			if mrows.Scan(&m.ID, &m.ProjectID, &m.Kind, &m.Content, &m.Provenance, &m.Confidence, &ts) != nil {
				continue
			}
			m.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			snap.MemoryEntries = append(snap.MemoryEntries, m)
		}
	}
	if snap.MemoryEntries == nil {
		snap.MemoryEntries = []MemoryEntry{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=bridge-snapshot.json")
	json.NewEncoder(w).Encode(snap)
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var snap Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "bad snapshot: "+err.Error(), 400)
		return
	}
	for _, p := range snap.Projects {
		ts := p.CreatedAt
		if ts.IsZero() {
			ts = time.Now().UTC()
		}
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO projects (id, name, description, rules, created_at) VALUES (?, ?, ?, ?, ?)`,
			p.ID, p.Name, p.Description, p.Rules, ts.Format(time.RFC3339))
	}
	for _, a := range snap.Artifacts {
		ts := a.CreatedAt
		if ts.IsZero() {
			ts = time.Now().UTC()
		}
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO artifacts (id, project_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			a.ID, a.ProjectID, a.Name, a.Kind, a.Content, ts.Format(time.RFC3339))
	}
	for _, t := range snap.EngineeringTasks {
		cAt, uAt := t.CreatedAt, t.UpdatedAt
		if cAt.IsZero() {
			cAt = time.Now().UTC()
		}
		if uAt.IsZero() {
			uAt = cAt
		}
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO engineering_tasks
			(id, project_id, title, objective, acceptance, owner, status, depends_on, evidence, revision, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			t.ID, t.ProjectID, t.Title, t.Objective, t.Acceptance, t.Owner, t.Status, t.DependsOn, t.Evidence, t.Revision,
			cAt.Format(time.RFC3339), uAt.Format(time.RFC3339))
	}
	for _, m := range snap.MemoryEntries {
		ts := m.CreatedAt
		if ts.IsZero() {
			ts = time.Now().UTC()
		}
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO memory_entries (id, project_id, kind, content, provenance, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			m.ID, m.ProjectID, m.Kind, m.Content, m.Provenance, m.Confidence, ts.Format(time.RFC3339))
	}
	if snap.State.Version > 0 || snap.State.TaskTitle != "" || snap.State.ProjectID != "" {
		s.mu.Lock()
		s.state = snap.State
		s.state.Version++
		s.state.LastUpdated = time.Now().UTC()
		s.saveState()
		s.mu.Unlock()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "imported",
		"projects":          len(snap.Projects),
		"artifacts":         len(snap.Artifacts),
		"engineering_tasks": len(snap.EngineeringTasks),
		"memory_entries":    len(snap.MemoryEntries),
	})
}
