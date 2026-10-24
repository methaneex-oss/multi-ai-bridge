package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

type EngineeringTask struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"project_id"`
	Title      string    `json:"title"`
	Objective  string    `json:"objective"`
	Acceptance string    `json:"acceptance"`
	Owner      string    `json:"owner"`
	Status     string    `json:"status"`
	DependsOn  string    `json:"depends_on"`
	Evidence   string    `json:"evidence"`
	Revision   string    `json:"revision"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type MemoryEntry struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"project_id"`
	Kind       string    `json:"kind"`
	Content    string    `json:"content"`
	Provenance string    `json:"provenance"`
	Confidence string    `json:"confidence"`
	CreatedAt  time.Time `json:"created_at"`
}

func migrateCoord(db *sql.DB) {
	_, _ = db.Exec(`
		CREATE TABLE IF NOT EXISTS engineering_tasks (
			id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, objective TEXT, acceptance TEXT,
			owner TEXT, status TEXT NOT NULL, depends_on TEXT, evidence TEXT, revision TEXT,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS memory_entries (
			id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL,
			provenance TEXT, confidence TEXT, created_at TEXT NOT NULL);
	`)
}

var taskTransitions = map[string][]string{
	"proposed": {"ready", "open", "cancelled"}, "ready": {"assigned", "open", "cancelled"},
	"assigned": {"in_progress", "cancelled", "blocked"}, "open": {"in_progress", "assigned", "ready", "cancelled", "blocked"},
	"in_progress": {"implemented", "blocked", "failed", "cancelled", "open"},
	"implemented": {"under_review", "in_progress", "failed"},
	"under_review": {"verified", "in_progress", "failed", "cancelled"},
	"verified": {"integrated", "in_progress"}, "integrated": {},
	"blocked": {"open", "in_progress", "assigned", "cancelled"},
	"failed": {"open", "in_progress", "cancelled"}, "cancelled": {"open", "proposed"}, "superseded": {},
}

func normalizeStatus(s string) string {
	out := ""
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			out += string(r + 32)
		} else if r == ' ' || r == '-' {
			out += "_"
		} else {
			out += string(r)
		}
	}
	return out
}

func canTransition(from, to string) bool {
	from, to = normalizeStatus(from), normalizeStatus(to)
	if from == to || to == "" {
		return true
	}
	allowed, ok := taskTransitions[from]
	if !ok {
		_, known := taskTransitions[to]
		return known
	}
	for _, a := range allowed {
		if a == to {
			return true
		}
	}
	return false
}

func (s *Server) enrichPack(base, projectID string) string {
	b := base
	rows, err := s.db.Query(`SELECT id, title, objective, acceptance, owner, status FROM engineering_tasks
		WHERE (project_id = ? OR project_id = '' OR ? = '') AND status IN ('open','in_progress','blocked','assigned','ready','proposed','implemented','under_review')
		ORDER BY created_at ASC LIMIT 40`, projectID, projectID)
	if err == nil {
		defer rows.Close()
		section := "\n=== OPEN ENGINEERING TASKS ===\n"
		n := 0
		for rows.Next() {
			var id, title, obj, acc, owner, status string
			if rows.Scan(&id, &title, &obj, &acc, &owner, &status) != nil {
				continue
			}
			section += "- [" + status + "] " + title + " (id=" + id + ", owner=" + owner + ")\n"
			if obj != "" {
				section += "  objective: " + obj + "\n"
			}
			if acc != "" {
				section += "  acceptance: " + acc + "\n"
			}
			n++
		}
		if n > 0 {
			b += section
		}
	}
	rows2, err := s.db.Query(`SELECT kind, content, confidence, provenance FROM memory_entries
		WHERE project_id = ? OR project_id = '' OR ? = '' ORDER BY created_at DESC LIMIT 30`, projectID, projectID)
	if err == nil {
		defer rows2.Close()
		section := "\n=== PROJECT MEMORY (evidence-tagged) ===\n"
		n := 0
		for rows2.Next() {
			var kind, content, conf, prov string
			if rows2.Scan(&kind, &content, &conf, &prov) != nil {
				continue
			}
			section += "- [" + kind + "|" + conf + "] " + content
			if prov != "" {
				section += " (src: " + prov + ")"
			}
			section += "\n"
			n++
		}
		if n > 0 {
			b += section
		}
	}
	return b
}

func (s *Server) handleEngineeringTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		pid := r.URL.Query().Get("project_id")
		status := r.URL.Query().Get("status")
		q := `SELECT id, project_id, title, objective, acceptance, owner, status, depends_on, evidence, revision, created_at, updated_at FROM engineering_tasks`
		var where []string
		var args []interface{}
		if pid != "" {
			where = append(where, "project_id = ?")
			args = append(args, pid)
		}
		if status != "" {
			where = append(where, "status = ?")
			args = append(args, normalizeStatus(status))
		}
		if len(where) > 0 {
			q += " WHERE " + where[0]
			for i := 1; i < len(where); i++ {
				q += " AND " + where[i]
			}
		}
		q += " ORDER BY created_at DESC LIMIT 200"
		rows, err := s.db.Query(q, args...)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []EngineeringTask
		for rows.Next() {
			var t EngineeringTask
			var cAt, uAt string
			if rows.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Objective, &t.Acceptance, &t.Owner, &t.Status, &t.DependsOn, &t.Evidence, &t.Revision, &cAt, &uAt) != nil {
				continue
			}
			t.CreatedAt, _ = time.Parse(time.RFC3339, cAt)
			t.UpdatedAt, _ = time.Parse(time.RFC3339, uAt)
			list = append(list, t)
		}
		if list == nil {
			list = []EngineeringTask{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct {
			ID, ProjectID, Title, Objective, Acceptance, Owner, Status, DependsOn, Evidence, Revision string
			ProjectIDSnake string `json:"project_id"`
			DependsSnake   string `json:"depends_on"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.ProjectID == "" && body.ProjectIDSnake != "" {
			body.ProjectID = body.ProjectIDSnake
		}
		if body.DependsOn == "" && body.DependsSnake != "" {
			body.DependsOn = body.DependsSnake
		}
		if body.Title == "" {
			http.Error(w, "title required", 400)
			return
		}
		if body.Status == "" {
			body.Status = "open"
		} else {
			body.Status = normalizeStatus(body.Status)
			if _, ok := taskTransitions[body.Status]; !ok {
				http.Error(w, "unknown status: "+body.Status, 400)
				return
			}
		}
		now := time.Now().UTC()
		id := body.ID
		if id == "" {
			id = now.Format("20060102150405.000000000")
		}
		_, _ = s.db.Exec(`INSERT INTO engineering_tasks
			(id, project_id, title, objective, acceptance, owner, status, depends_on, evidence, revision, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Title, body.Objective, body.Acceptance, body.Owner, body.Status, body.DependsOn, body.Evidence, body.Revision,
			now.Format(time.RFC3339), now.Format(time.RFC3339))
		t := EngineeringTask{ID: id, ProjectID: body.ProjectID, Title: body.Title, Objective: body.Objective, Acceptance: body.Acceptance,
			Owner: body.Owner, Status: body.Status, DependsOn: body.DependsOn, Evidence: body.Evidence, Revision: body.Revision, CreatedAt: now, UpdatedAt: now}
		s.hub.publish("engineering_task", t)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(t)
	case http.MethodPatch:
		var body struct {
			ID, Status, Evidence, Owner, Revision string
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.ID == "" {
			http.Error(w, "id required", 400)
			return
		}
		var curStatus string
		err := s.db.QueryRow(`SELECT status FROM engineering_tasks WHERE id = ?`, body.ID).Scan(&curStatus)
		if err != nil {
			http.Error(w, "task not found", 404)
			return
		}
		if body.Status != "" {
			body.Status = normalizeStatus(body.Status)
			if !canTransition(curStatus, body.Status) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "invalid_transition", "from": curStatus, "to": body.Status, "id": body.ID,
					"hint":  "allowed moves follow handbook task states",
				})
				return
			}
			if body.Status == "verified" && s.countPassingVerifications(body.ID) == 0 {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "verification_required", "id": body.ID,
					"hint":  "POST /api/v1/verifications with result=pass before status=verified",
				})
				return
			}
		}
		now := time.Now().UTC().Format(time.RFC3339)
		_, _ = s.db.Exec(`UPDATE engineering_tasks SET
			status = COALESCE(NULLIF(?, ''), status), evidence = COALESCE(NULLIF(?, ''), evidence),
			owner = COALESCE(NULLIF(?, ''), owner), revision = COALESCE(NULLIF(?, ''), revision), updated_at = ?
			WHERE id = ?`, body.Status, body.Evidence, body.Owner, body.Revision, now, body.ID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "updated", "id": body.ID, "from": curStatus, "to": body.Status})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		pid := r.URL.Query().Get("project_id")
		q := `SELECT id, project_id, kind, content, provenance, confidence, created_at FROM memory_entries`
		var args []interface{}
		if pid != "" {
			q += ` WHERE project_id = ?`
			args = append(args, pid)
		}
		q += ` ORDER BY created_at DESC LIMIT 200`
		rows, err := s.db.Query(q, args...)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []MemoryEntry
		for rows.Next() {
			var m MemoryEntry
			var ts string
			if rows.Scan(&m.ID, &m.ProjectID, &m.Kind, &m.Content, &m.Provenance, &m.Confidence, &ts) != nil {
				continue
			}
			m.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, m)
		}
		if list == nil {
			list = []MemoryEntry{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct {
			ProjectID  string `json:"project_id"`
			Kind       string `json:"kind"`
			Content    string `json:"content"`
			Provenance string `json:"provenance"`
			Confidence string `json:"confidence"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.Kind == "" || body.Content == "" {
			http.Error(w, "kind and content required", 400)
			return
		}
		if body.Confidence == "" {
			body.Confidence = "unverified"
		}
		now := time.Now().UTC()
		id := now.Format("20060102150405.000000000")
		_, _ = s.db.Exec(`INSERT INTO memory_entries (id, project_id, kind, content, provenance, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Kind, body.Content, body.Provenance, body.Confidence, now.Format(time.RFC3339))
		m := MemoryEntry{ID: id, ProjectID: body.ProjectID, Kind: body.Kind, Content: body.Content, Provenance: body.Provenance, Confidence: body.Confidence, CreatedAt: now}
		s.hub.publish("memory", m)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(m)
	default:
		http.Error(w, "method not allowed", 405)
	}
}
