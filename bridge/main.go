package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"
)

type State struct {
	ProjectID       string            `json:"project_id"`
	TaskTitle       string            `json:"task_title"`
	TaskDescription string            `json:"task_description"`
	Instructions    string            `json:"instructions"`
	Goals           []string          `json:"goals"`
	Constraints     []string          `json:"constraints"`
	Roles           map[string]string `json:"roles"`
	OpenQuestions   []string          `json:"open_questions"`
	Decisions       []string          `json:"decisions"`
	CurrentStatus   string            `json:"current_status"`
	AgentLock       string            `json:"agent_lock"`
	LastUpdated     time.Time         `json:"last_updated"`
	Version         int               `json:"version"`
}

type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type Artifact struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type Contribution struct {
	ID               string                 `json:"id"`
	Timestamp        time.Time              `json:"timestamp"`
	AgentName        string                 `json:"agent_name"`
	Role             string                 `json:"role"`
	Content          string                 `json:"content"`
	ContributionType string                 `json:"contribution_type"`
	RelatedTo        *string                `json:"related_to"`
	Metadata         map[string]interface{} `json:"metadata"`
}

type Job struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	Kind      string    `json:"kind"` // build | test | run | custom
	Command   string    `json:"command"`
	Status    string    `json:"status"` // queued | running | succeeded | failed
	Log       string    `json:"log"`
	CreatedAt time.Time `json:"created_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type Server struct {
	db       *sql.DB
	mu       sync.RWMutex
	state    State
	apiKey   string
	hub      *Hub
	workDir  string
	allowExec bool
}

type Hub struct {
	clients    map[*websocket.Conn]bool
	broadcast  chan []byte
	register   chan *websocket.Conn
	unregister chan *websocket.Conn
	mu         sync.Mutex
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[*websocket.Conn]bool),
		broadcast:  make(chan []byte, 64),
		register:   make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}

func (h *Hub) run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				c.Close()
			}
			h.mu.Unlock()
		case msg := <-h.broadcast:
			h.mu.Lock()
			for c := range h.clients {
				if err := c.WriteMessage(websocket.TextMessage, msg); err != nil {
					c.Close()
					delete(h.clients, c)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) publish(event string, payload interface{}) {
	b, _ := json.Marshal(map[string]interface{}{"event": event, "data": payload})
	select {
	case h.broadcast <- b:
	default:
	}
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.hub.register <- c
	s.mu.RLock()
	st := s.state
	s.mu.RUnlock()
	b, _ := json.Marshal(map[string]interface{}{"event": "state", "data": st})
	_ = c.WriteMessage(websocket.TextMessage, b)
	go func() {
		defer func() { s.hub.unregister <- c }()
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

func main() {
	port := os.Getenv("BRIDGE_PORT")
	if port == "" {
		port = "8080"
	}
	dbPath := os.Getenv("DATABASE_PATH")
	if dbPath == "" {
		dbPath = "./data/bridge.db"
	}
	workDir := os.Getenv("WORKSPACE_DIR")
	if workDir == "" {
		workDir = "./workspace"
	}
	os.MkdirAll(workDir, 0755)
	os.MkdirAll("./data", 0755)

	allowExec := os.Getenv("ALLOW_EXEC") == "1" || os.Getenv("ALLOW_EXEC") == "true"

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := initDB(db); err != nil {
		log.Fatal(err)
	}

	hub := newHub()
	go hub.run()

	s := &Server{db: db, apiKey: os.Getenv("BRIDGE_API_KEY"), hub: hub, workDir: workDir, allowExec: allowExec}
	s.state = State{
		Roles: make(map[string]string), Goals: []string{}, Constraints: []string{},
		OpenQuestions: []string{}, Decisions: []string{}, CurrentStatus: "idle", LastUpdated: time.Now().UTC(),
	}
	s.loadState()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withCORS(s.handleHealth))
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/api/v1/state", withCORS(s.auth(s.handleState)))
	mux.HandleFunc("/api/v1/task", withCORS(s.auth(s.handleTask)))
	mux.HandleFunc("/api/v1/contribute", withCORS(s.auth(s.handleContribute)))
	mux.HandleFunc("/api/v1/history", withCORS(s.auth(s.handleHistory)))
	mux.HandleFunc("/api/v1/role", withCORS(s.auth(s.handleRole)))
	mux.HandleFunc("/api/v1/roles", withCORS(s.auth(s.handleRoles)))
	mux.HandleFunc("/api/v1/projects", withCORS(s.auth(s.handleProjects)))
	mux.HandleFunc("/api/v1/artifacts", withCORS(s.auth(s.handleArtifacts)))
	mux.HandleFunc("/api/v1/lock", withCORS(s.auth(s.handleLock)))
	mux.HandleFunc("/api/v1/jobs", withCORS(s.auth(s.handleJobs)))

	log.Printf("Multi-AI Bridge on :%s (exec allowed=%v)", port, allowExec)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func initDB(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS contributions (
			id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, agent_name TEXT NOT NULL, role TEXT NOT NULL,
			content TEXT NOT NULL, contribution_type TEXT NOT NULL, related_to TEXT, metadata TEXT);
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS artifacts (
			id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
			content TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS jobs (
			id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, command TEXT NOT NULL,
			status TEXT NOT NULL, log TEXT, created_at TEXT NOT NULL, finished_at TEXT);
	`)
	return err
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.apiKey != "" && r.Header.Get("X-API-Key") != s.apiKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok", "service": "multi-ai-bridge", "exec_enabled": s.allowExec,
	})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.state)
}

func (s *Server) handleTask(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct {
		Title, Description, Instructions, ProjectID string
		Goals, Constraints                         []string
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	s.mu.Lock()
	s.state.TaskTitle = body.Title
	s.state.TaskDescription = body.Description
	s.state.Instructions = body.Instructions
	s.state.Goals = body.Goals
	s.state.Constraints = body.Constraints
	if body.ProjectID != "" {
		s.state.ProjectID = body.ProjectID
	}
	s.state.CurrentStatus = "active"
	s.state.LastUpdated = time.Now().UTC()
	s.state.Version++
	st := s.state
	s.saveState()
	s.mu.Unlock()
	s.hub.publish("state", st)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(st)
}

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
	contrib := Contribution{ID: id, Timestamp: ts, AgentName: body.AgentName, Role: body.Role, Content: body.Content, ContributionType: body.ContributionType, RelatedTo: body.RelatedTo, Metadata: body.Metadata}
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
		if err := rows.Scan(&c.ID, &ts, &c.AgentName, &c.Role, &c.Content, &c.ContributionType, &related, &meta); err != nil {
			continue
		}
		c.Timestamp, _ = time.Parse(time.RFC3339, ts)
		if related != "" {
			c.RelatedTo = &related
		}
		json.Unmarshal([]byte(meta), &c.Metadata)
		list = append(list, c)
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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	s.mu.Lock()
	if s.state.Roles == nil {
		s.state.Roles = make(map[string]string)
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
		rows, _ := s.db.Query(`SELECT id, name, description, created_at FROM projects ORDER BY created_at DESC`)
		defer rows.Close()
		var list []Project
		for rows.Next() {
			var p Project
			var ts string
			rows.Scan(&p.ID, &p.Name, &p.Description, &ts)
			p.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, p)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ Name, Description string }
		json.NewDecoder(r.Body).Decode(&body)
		id := time.Now().Format("20060102150405")
		ts := time.Now().UTC()
		s.db.Exec(`INSERT INTO projects (id, name, description, created_at) VALUES (?, ?, ?, ?)`, id, body.Name, body.Description, ts.Format(time.RFC3339))
		os.MkdirAll(filepath.Join(s.workDir, id), 0755)
		s.mu.Lock()
		s.state.ProjectID = id
		s.state.LastUpdated = ts
		s.state.Version++
		st := s.state
		s.saveState()
		s.mu.Unlock()
		s.hub.publish("state", st)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Project{ID: id, Name: body.Name, Description: body.Description, CreatedAt: ts})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleArtifacts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		pid := r.URL.Query().Get("project_id")
		var rows *sql.Rows
		if pid != "" {
			rows, _ = s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`, pid)
		} else {
			rows, _ = s.db.Query(`SELECT id, project_id, name, kind, content, created_at FROM artifacts ORDER BY created_at DESC LIMIT 100`)
		}
		defer rows.Close()
		var list []Artifact
		for rows.Next() {
			var a Artifact
			var ts string
			rows.Scan(&a.ID, &a.ProjectID, &a.Name, &a.Kind, &a.Content, &ts)
			a.CreatedAt, _ = time.Parse(time.RFC3339, ts)
			list = append(list, a)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ ProjectID, Name, Kind, Content string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Kind == "" {
			body.Kind = "note"
		}
		id := time.Now().Format("20060102150405.000000000")
		ts := time.Now().UTC()
		s.db.Exec(`INSERT INTO artifacts (id, project_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Name, body.Kind, body.Content, ts.Format(time.RFC3339))
		// also write to workspace if name looks like a relative path
		if body.ProjectID != "" && body.Name != "" && !strings.Contains(body.Name, "..") {
			p := filepath.Join(s.workDir, body.ProjectID, body.Name)
			os.MkdirAll(filepath.Dir(p), 0755)
			_ = os.WriteFile(p, []byte(body.Content), 0644)
		}
		a := Artifact{ID: id, ProjectID: body.ProjectID, Name: body.Name, Kind: body.Kind, Content: body.Content, CreatedAt: ts}
		s.hub.publish("artifact", a)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleLock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct{ AgentName, Action string }
	json.NewDecoder(r.Body).Decode(&body)
	s.mu.Lock()
	defer s.mu.Unlock()
	switch body.Action {
	case "acquire":
		if s.state.AgentLock != "" && s.state.AgentLock != body.AgentName {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(409)
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
		rows, _ := s.db.Query(`SELECT id, project_id, kind, command, status, log, created_at, finished_at FROM jobs ORDER BY created_at DESC LIMIT 50`)
		defer rows.Close()
		var list []Job
		for rows.Next() {
			var j Job
			var ts, fin sql.NullString
			rows.Scan(&j.ID, &j.ProjectID, &j.Kind, &j.Command, &j.Status, &j.Log, &ts, &fin)
			if ts.Valid {
				j.CreatedAt, _ = time.Parse(time.RFC3339, ts.String)
			}
			if fin.Valid {
				t, _ := time.Parse(time.RFC3339, fin.String)
				j.FinishedAt = &t
			}
			list = append(list, j)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var body struct{ ProjectID, Kind, Command string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Kind == "" {
			body.Kind = "custom"
		}
		if body.Command == "" {
			http.Error(w, "command required", 400)
			return
		}
		// safety: only allow when explicitly enabled
		if !s.allowExec {
			http.Error(w, "execution disabled. Set ALLOW_EXEC=true on the server", 403)
			return
		}
		// block dangerous patterns
		lower := strings.ToLower(body.Command)
		for _, bad := range []string{"rm -rf /", "mkfs", ":(){", "shutdown", "reboot"} {
			if strings.Contains(lower, bad) {
				http.Error(w, "command blocked", 400)
				return
			}
		}
		id := time.Now().Format("20060102150405.000000000")
		ts := time.Now().UTC()
		s.db.Exec(`INSERT INTO jobs (id, project_id, kind, command, status, log, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, body.ProjectID, body.Kind, body.Command, "queued", "", ts.Format(time.RFC3339))
		job := Job{ID: id, ProjectID: body.ProjectID, Kind: body.Kind, Command: body.Command, Status: "queued", CreatedAt: ts}
		s.hub.publish("job", job)
		go s.runJob(id, body.ProjectID, body.Command)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(job)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) runJob(id, projectID, command string) {
	s.db.Exec(`UPDATE jobs SET status = ? WHERE id = ?`, "running", id)
	s.hub.publish("job", map[string]string{"id": id, "status": "running"})

	dir := s.workDir
	if projectID != "" {
		dir = filepath.Join(s.workDir, projectID)
		os.MkdirAll(dir, 0755)
	}

	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	status := "succeeded"
	logText := string(out)
	if err != nil {
		status = "failed"
		logText = logText + "\n" + err.Error()
	}
	if len(logText) > 100000 {
		logText = logText[:100000] + "\n...truncated"
	}
	fin := time.Now().UTC()
	s.db.Exec(`UPDATE jobs SET status = ?, log = ?, finished_at = ? WHERE id = ?`, status, logText, fin.Format(time.RFC3339), id)
	// store log as artifact
	artID := time.Now().Format("20060102150405.000000000")
	s.db.Exec(`INSERT INTO artifacts (id, project_id, name, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		artID, projectID, "job-"+id+".log", "log", logText, fin.Format(time.RFC3339))
	s.hub.publish("job", map[string]interface{}{"id": id, "status": status, "log": logText})
}

func (s *Server) saveState() {
	data, _ := json.Marshal(s.state)
	s.db.Exec(`INSERT OR REPLACE INTO state (id, data) VALUES (1, ?)`, string(data))
}

func (s *Server) loadState() {
	var data string
	if s.db.QueryRow(`SELECT data FROM state WHERE id = 1`).Scan(&data) == nil {
		json.Unmarshal([]byte(data), &s.state)
		if s.state.Roles == nil {
			s.state.Roles = make(map[string]string)
		}
	}
}
