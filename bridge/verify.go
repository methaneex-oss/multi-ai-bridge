package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// VerificationRecord is independent evidence that a task met acceptance criteria.
// Handbook §7.3 / §8: implementer claim is not verification.
type VerificationRecord struct {
	ID                string    `json:"id"`
	TaskID            string    `json:"task_id"`
	ProjectID         string    `json:"project_id"`
	CheckName         string    `json:"check_name"`
	CommandOrMethod   string    `json:"command_or_method"`
	Result            string    `json:"result"`
	Summary           string    `json:"summary"`
	ArtifactRef       string    `json:"artifact_ref"`
	VerifiedBy        string    `json:"verified_by"`
	CandidateRevision string    `json:"candidate_revision"`
	CreatedAt         time.Time `json:"created_at"`
}

func migrateVerifySQL(s *Server) {
	_, _ = s.db.Exec(`
		CREATE TABLE IF NOT EXISTS verification_records (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			project_id TEXT,
			check_name TEXT NOT NULL,
			command_or_method TEXT,
			result TEXT NOT NULL,
			summary TEXT,
			artifact_ref TEXT,
			verified_by TEXT,
			candidate_revision TEXT,
			created_at TEXT NOT NULL
		);
	`)
}

func (s *Server) countPassingVerifications(taskID string) int {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM verification_records WHERE task_id = ? AND result = 'pass'`, taskID).Scan(&n)
	return n
}

func (s *Server) handleVerifications(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		taskID := r.URL.Query().Get("task_id")
		q := `SELECT id, task_id, project_id, check_name, command_or_method, result, summary, artifact_ref, verified_by, candidate_revision, created_at FROM verification_records`
		var args []interface{}
		if taskID != "" {
			q += ` WHERE task_id = ?`
			args = append(args, taskID)
		}
		q += ` ORDER BY created_at DESC LIMIT 100`
		rows, err := s.db.Query(q, args...)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		defer rows.Close()
		var list []VerificationRecord
		for rows.Next() {
			var v VerificationRecord
			var ts string
			if rows.Scan(&v.ID, &v.TaskID, &v.ProjectID, &v.CheckName, &v.CommandOrMethod, &v.Result, &v.Summary, &v.ArtifactRef, &v.VerifiedBy, &v.CandidateRevision, &ts) != nil {
				continue
			}
			v.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, v)
		}
		if list == nil {
			list = []VerificationRecord{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct {
			TaskID            string `json:"task_id"`
			ProjectID         string `json:"project_id"`
			CheckName         string `json:"check_name"`
			CommandOrMethod   string `json:"command_or_method"`
			Result            string `json:"result"`
			Summary           string `json:"summary"`
			ArtifactRef       string `json:"artifact_ref"`
			VerifiedBy        string `json:"verified_by"`
			CandidateRevision string `json:"candidate_revision"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "bad request", 400)
			return
		}
		if body.TaskID == "" || body.CheckName == "" {
			http.Error(w, "task_id and check_name required", 400)
			return
		}
		body.Result = normalizeStatus(body.Result)
		if body.Result == "" {
			body.Result = "inconclusive"
		}
		if body.Result != "pass" && body.Result != "fail" && body.Result != "inconclusive" {
			http.Error(w, "result must be pass, fail, or inconclusive", 400)
			return
		}
		now := time.Now().UTC()
		id := now.Format("20060102150405.000000000")
		_, _ = s.db.Exec(`INSERT INTO verification_records
			(id, task_id, project_id, check_name, command_or_method, result, summary, artifact_ref, verified_by, candidate_revision, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, body.TaskID, body.ProjectID, body.CheckName, body.CommandOrMethod, body.Result, body.Summary, body.ArtifactRef, body.VerifiedBy, body.CandidateRevision, now.Format(time.RFC3339))
		v := VerificationRecord{
			ID: id, TaskID: body.TaskID, ProjectID: body.ProjectID, CheckName: body.CheckName,
			CommandOrMethod: body.CommandOrMethod, Result: body.Result, Summary: body.Summary,
			ArtifactRef: body.ArtifactRef, VerifiedBy: body.VerifiedBy, CandidateRevision: body.CandidateRevision, CreatedAt: now,
		}
		s.hub.publish("verification", v)
		kind := "fact"
		if body.Result == "fail" {
			kind = "failure"
		}
		conf := "verified"
		if body.Result != "pass" {
			conf = "unverified"
		}
		memID := now.Format("20060102150405.000000001")
		content := "Verification " + body.Result + " for task " + body.TaskID + ": " + body.CheckName
		if body.Summary != "" {
			content += " — " + body.Summary
		}
		_, _ = s.db.Exec(`INSERT INTO memory_entries (id, project_id, kind, content, provenance, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			memID, body.ProjectID, kind, content, "verification:"+id, conf, now.Format(time.RFC3339))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	default:
		http.Error(w, "method not allowed", 405)
	}
}
