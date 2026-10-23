package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	_ "modernc.org/sqlite"
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
	Rules       string    `json:"rules"`
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

type Job struct {
	ID        string     `json:"id"`
	ProjectID string     `json:"project_id"`
	Type      string     `json:"type"`
	Command   string     `json:"command"`
	Status    string     `json:"status"`
	Output    string     `json:"output"`
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	StartedAt *time.Time `json:"started_at,omitempty"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
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

type Server struct {
	db     *sql.DB
	mu     sync.RWMutex
	state  State
	apiKey string
	hub    *Hub
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
		clients: make(map[*websocket.Conn]bool), broadcast: make(chan []byte, 64),
		register: make(chan *websocket.Conn), unregister: make(chan *websocket.Conn),
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

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!DOCTYPE html><html><head><title>Multi-AI Bridge API</title></head><body><h1>Multi-AI Bridge API</h1><p><a href="/health">/health</a></p></body></html>`))
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
	apiKey := os.Getenv("BRIDGE_API_KEY")
	_ = os.MkdirAll("./data", 0755)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := initDB(db); err != nil {
		log.Fatal(err)
	}
	hub := newHub()
	go hub.run()
	s := &Server{db: db, apiKey: apiKey, hub: hub}
	s.state = State{Roles: make(map[string]string), Goals: []string{}, Constraints: []string{}, OpenQuestions: []string{}, Decisions: []string{}, CurrentStatus: "idle", LastUpdated: time.Now().UTC()}
	s.loadState()
	mux := http.NewServeMux()
	mux.HandleFunc("/", withCORS(s.handleRoot))
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
	mux.HandleFunc("/api/v1/context", withCORS(s.auth(s.handleContext)))
	mux.HandleFunc("/api/v1/knowledge", withCORS(s.auth(s.handleKnowledge)))
	log.Printf("Multi-AI Bridge listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
			id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, rules TEXT, created_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS artifacts (
			id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
			content TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS jobs (
			id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, command TEXT NOT NULL,
			status TEXT NOT NULL, output TEXT, created_by TEXT, created_at TEXT NOT NULL,
			started_at TEXT, ended_at TEXT);
	`)
	if err != nil {
		return err
	}
	_, _ = db.Exec("ALTER TABLE projects ADD COLUMN rules TEXT")
	return nil
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "multi-ai-bridge"})
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
		Goals, Constraints                          []string
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	s.mu.Lock()
	s.state.TaskTitle, s.state.TaskDescription = body.Title, body.Description
	s.state.Instructions = body.Instructions
	s.state.Goals, s.state.Constraints = body.Goals, body.Constraints
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
