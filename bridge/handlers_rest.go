package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

func (s *Server) handleContribute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct {
		AgentName, Role, Content, ContributionType string
		RelatedTo                                  *string
		Metadata                                   map[string]interface{}
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	id := time.Now().Format("20060102150405.000000000")
	meta, _ := json.Marshal(body.Metadata)
	related := ""
	if body.RelatedTo != nil {
		related = *body.RelatedTo
	}
	ts := time.Now().UTC()
	_, err := s.db.Exec(`INSERT INTO contributions (id, timestamp, agent_name, role, content, contribution_type, related_to, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, ts.Format(time.RFC3339), body.AgentName, body.Role, body.Content, body.ContributionType, related, string(meta))
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.mu.Lock()
	s.state.CurrentStatus = "last contribution by " + body.AgentName + " (" + body.Role + ")"
	s.state.LastUpdated = ts
	s.state.Version++
	if body.ContributionType == "question" {
		s.state.OpenQuestions = append(s.state.OpenQuestions, body.Content)
	}
	if body.ContributionType == "decision" {
		s.state.Decisions = append(s.state.Decisions, body.Content)
	}
	if s.state.AgentLock == body.AgentName {
		s.state.AgentLock = ""
	}
	st := s.state
	s.saveState()
	s.mu.Unlock()
	contrib := Contribution{ID: id, Timestamp: ts, AgentName: body.AgentName, Role: body.Role, Content: body.Content,
		ContributionType: body.ContributionType, RelatedTo: body.RelatedTo, Metadata: body.Metadata}
	s.hub.publish("contribution", contrib)
	s.hub.publish("state", st)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "ok"})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, timestamp, agent_name, role, content, contribution_type, related_to, metadata FROM contributions ORDER BY timestamp DESC LIMIT 50`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var list []Contribution
	for rows.Next() {
		var c Contribution
		var ts, related, meta string
		if rows.Scan(&c.ID, &ts, &c.AgentName, &c.Role, &c.Content, &c.ContributionType, &related, &meta) != nil {
			continue
		}
		c.Timestamp, _ = time.Parse(time.RFC3339, ts)
		if related != "" {
			c.RelatedTo = &related
		}
		_ = json.Unmarshal([]byte(meta), &c.Metadata)
		list = append(list, c)
	}
	if list == nil {
		list = []Contribution{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct{ AgentName, Role string }
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	s.mu.Lock()
	if s.state.Roles == nil {
		s.state.Roles = map[string]string{}
	}
	s.state.Roles[body.AgentName] = body.Role
	s.state.LastUpdated = time.Now().UTC()
	s.state.Version++
	st := s.state
	s.saveState()
	s.mu.Unlock()
	s.hub.publish("state", st)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(st)
}

func (s *Server) handleRoles(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.state.Roles)
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query(`SELECT id, name, description, COALESCE(rules,''), created_at FROM projects ORDER BY created_at DESC`)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []Project
		for rows.Next() {
			var p Project
			var ts string
			if rows.Scan(&p.ID, &p.Name, &p.Description, &p.Rules, &ts) != nil {
				continue
			}
			p.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, p)
		}
		if list == nil {
			list = []Project{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ ID, Name, Description, Rules string }
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.Name == "" {
			http.Error(w, "name required", 400)
			return
		}
		id := body.ID
		if id == "" {
			id = time.Now().Format("20060102150405")
		}
		ts := time.Now().UTC()
		_, _ = s.db.Exec(`INSERT OR REPLACE INTO projects (id, name, description, rules, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, body.Name, body.Description, body.Rules, ts.Format(time.RFC3339))
		s.mu.Lock()
		s.state.ProjectID = id
		s.state.LastUpdated = ts
		s.state.Version++
		st := s.state
		s.saveState()
		s.mu.Unlock()
		s.hub.publish("state", st)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Project{ID: id, Name: body.Name, Description: body.Description, Rules: body.Rules, CreatedAt: ts})
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "id required", 400)
			return
		}
		_, _ = s.db.Exec(`DELETE FROM artifacts WHERE project_id = ?`, id)
		_, _ = s.db.Exec(`DELETE FROM projects WHERE id = ?`, id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "id": id})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleArtifacts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		pid := r.URL.Query().Get("project_id")
		var rows *sql.Rows
		var err error
		if pid != "" {
			rows, err = s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`, pid)
		} else {
			rows, err = s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts ORDER BY created_at DESC LIMIT 100`)
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []Artifact
		for rows.Next() {
			var a Artifact
			var ts string
			if rows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Kind, &a.Content, &ts) != nil {
				continue
			}
			a.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, a)
		}
		if list == nil {
			list = []Artifact{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ ProjectID, Name, Kind, Content string }
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.ProjectID == "" {
			http.Error(w, "project_id required", 400)
			return
		}
		if body.Kind == "" {
			body.Kind = "knowledge"
		}
		if body.Name == "" {
			body.Name = "untitled"
		}
		id := time.Now().Format("20060102150405.000000000")
		ts := time.Now().UTC()
		_, _ = s.db.Exec(`INSERT INTO artifacts (id, project_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Name, body.Kind, body.Content, ts.Format(time.RFC3339))
		a := Artifact{ID: id, ProjectID: body.ProjectID, Name: body.Name, Kind: body.Kind, Content: body.Content, CreatedAt: ts}
		s.hub.publish("artifact", a)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a)
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "id required", 400)
			return
		}
		_, _ = s.db.Exec(`DELETE FROM artifacts WHERE id = ?`, id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "id": id})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleKnowledge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct{ ProjectID, Name, Content, Kind string }
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	if body.ProjectID == "" || body.Content == "" {
		http.Error(w, "project_id and content required", 400)
		return
	}
	if body.Kind == "" {
		body.Kind = "knowledge"
	}
	if body.Name == "" {
		body.Name = "training-" + time.Now().Format("150405")
	}
	id := time.Now().Format("20060102150405.000000000")
	ts := time.Now().UTC()
	_, _ = s.db.Exec(`INSERT INTO artifacts (id, project_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, body.ProjectID, body.Name, body.Kind, body.Content, ts.Format(time.RFC3339))
	a := Artifact{ID: id, ProjectID: body.ProjectID, Name: body.Name, Kind: body.Kind, Content: body.Content, CreatedAt: ts}
	s.hub.publish("artifact", a)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(a)
}

func (s *Server) handleContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	pid := r.URL.Query().Get("project_id")
	s.mu.RLock()
	st := s.state
	s.mu.RUnlock()
	if pid == "" {
		pid = st.ProjectID
	}
	var proj Project
	var ts string
	err := s.db.QueryRow(`SELECT id, name, description, COALESCE(rules,''), created_at FROM projects WHERE id = ?`, pid).
		Scan(&proj.ID, &proj.Name, &proj.Description, &proj.Rules, &ts)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"project_id": pid, "project": nil, "task": st, "knowledge": []Artifact{}, "pack": buildPack(nil, nil, st),
		})
		return
	}
	proj.CreatedAt, _ = time.Parse(time.RFC3339, ts)
	rows, err := s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at ASC`, pid)
	var knowledge []Artifact
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var a Artifact
			var ats string
			if rows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Kind, &a.Content, &ats) != nil {
				continue
			}
			a.CreatedAt, _ = time.Parse(time.RFC3339, ats)
			knowledge = append(knowledge, a)
		}
	}
	if knowledge == nil {
		knowledge = []Artifact{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"project_id": pid, "project": proj, "task": st, "knowledge": knowledge, "pack": buildPack(&proj, knowledge, st),
	})
}

func buildPack(proj *Project, knowledge []Artifact, st State) string {
	b := "=== PROJECT ===\n"
	if proj != nil {
		b += "Name: " + proj.Name + "\n"
		if proj.Description != "" {
			b += "Description: " + proj.Description + "\n"
		}
		if proj.Rules != "" {
			b += "\n--- Project rules (always follow) ---\n" + proj.Rules + "\n"
		}
	} else {
		b += "(no project selected)\n"
	}
	if len(knowledge) > 0 {
		b += "\n=== PROJECT KNOWLEDGE / TRAINING DATA ===\n"
		b += "Use this material as ground truth. Prefer it over guessing.\n\n"
		const maxTotal = 24000
		used := 0
		for _, a := range knowledge {
			chunk := "[" + a.Kind + "] " + a.Name + "\n" + a.Content + "\n\n"
			if used+len(chunk) > maxTotal {
				remain := maxTotal - used
				if remain > 200 {
					b += chunk[:remain] + "\n...[truncated]\n"
				}
				break
			}
			b += chunk
			used += len(chunk)
		}
	}
	b += "\n=== CURRENT TASK ===\n"
	b += "Title: " + st.TaskTitle + "\n"
	b += "Description: " + st.TaskDescription + "\n"
	if st.Instructions != "" {
		b += "\n--- Task rules ---\n" + st.Instructions + "\n"
	}
	return b
}

func (s *Server) handleLock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct{ AgentName, Action string }
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "bad request", 400)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch body.Action {
	case "acquire":
		if s.state.AgentLock != "" && s.state.AgentLock != body.AgentName {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"status": "busy", "held_by": s.state.AgentLock})
			return
		}
		s.state.AgentLock = body.AgentName
	case "release":
		if s.state.AgentLock == body.AgentName {
			s.state.AgentLock = ""
		}
	default:
		http.Error(w, "action must be acquire or release", 400)
		return
	}
	s.state.LastUpdated = time.Now().UTC()
	s.state.Version++
	st := s.state
	s.saveState()
	s.hub.publish("state", st)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(st)
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query(`SELECT id, project_id, type, command, status, COALESCE(output,''), COALESCE(created_by,''), created_at FROM jobs ORDER BY created_at DESC LIMIT 50`)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []Job
		for rows.Next() {
			var j Job
			var ts string
			if rows.Scan(&j.ID, &j.ProjectID, &j.Type, &j.Command, &j.Status, &j.Output, &j.CreatedBy, &ts) != nil {
				continue
			}
			j.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, j)
		}
		if list == nil {
			list = []Job{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ ProjectID, Type, Command, CreatedBy string }
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.Type == "" {
			body.Type = "shell"
		}
		id := time.Now().Format("20060102150405.000000000")
		ts := time.Now().UTC()
		_, _ = s.db.Exec(`INSERT INTO jobs (id, project_id, type, command, status, output, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Type, body.Command, "queued", "", body.CreatedBy, ts.Format(time.RFC3339))
		j := Job{ID: id, ProjectID: body.ProjectID, Type: body.Type, Command: body.Command, Status: "queued", CreatedBy: body.CreatedBy, CreatedAt: ts}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(j)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) saveState() {
	b, _ := json.Marshal(s.state)
	_, _ = s.db.Exec(`INSERT INTO state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, string(b))
}

func (s *Server) loadState() {
	var data string
	err := s.db.QueryRow(`SELECT data FROM state WHERE id = 1`).Scan(&data)
	if err != nil {
		return
	}
	_ = json.Unmarshal([]byte(data), &s.state)
	if s.state.Roles == nil {
		s.state.Roles = map[string]string{}
	}
}
