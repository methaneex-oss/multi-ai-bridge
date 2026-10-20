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
	_ "github.com/mattn/go-sqlite3"
)

type State struct {
	TaskTitle       string            `json:"task_title"`
	TaskDescription string            `json:"task_description"`
	Instructions    string            `json:"instructions"`
	Goals           []string          `json:"goals"`
	Constraints     []string          `json:"constraints"`
	Roles           map[string]string `json:"roles"`
	OpenQuestions   []string          `json:"open_questions"`
	Decisions       []string          `json:"decisions"`
	CurrentStatus   string            `json:"current_status"`
	LastUpdated     time.Time         `json:"last_updated"`
	Version         int               `json:"version"`
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

// ── WebSocket hub ──

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
	// send current state immediately
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

// ── main ──

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

	os.MkdirAll("./data", 0755)
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

	s := &Server{db: db, apiKey: apiKey, hub: hub}
	s.state = State{
		Roles:         make(map[string]string),
		Goals:         []string{},
		Constraints:   []string{},
		OpenQuestions: []string{},
		Decisions:     []string{},
		CurrentStatus: "idle",
		LastUpdated:   time.Now().UTC(),
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

	log.Printf("Multi-AI Bridge listening on :%s (REST + WebSocket /ws)", port)
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
		CREATE TABLE IF NOT EXISTS state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS contributions (
			id TEXT PRIMARY KEY,
			timestamp TEXT NOT NULL,
			agent_name TEXT NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			contribution_type TEXT NOT NULL,
			related_to TEXT,
			metadata TEXT
		);
	`)
	return err
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.apiKey != "" {
			if r.Header.Get("X-API-Key") != s.apiKey {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Title        string   `json:"title"`
		Description  string   `json:"description"`
		Instructions string   `json:"instructions"`
		Goals        []string `json:"goals"`
		Constraints  []string `json:"constraints"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.state.TaskTitle = body.Title
	s.state.TaskDescription = body.Description
	s.state.Instructions = body.Instructions
	s.state.Goals = body.Goals
	s.state.Constraints = body.Constraints
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		AgentName        string                 `json:"agent_name"`
		Role             string                 `json:"role"`
		Content          string                 `json:"content"`
		ContributionType string                 `json:"contribution_type"`
		RelatedTo        *string                `json:"related_to"`
		Metadata         map[string]interface{} `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id := time.Now().Format("20060102150405.000000000")
	meta, _ := json.Marshal(body.Metadata)
	related := ""
	if body.RelatedTo != nil {
		related = *body.RelatedTo
	}
	ts := time.Now().UTC()
	_, err := s.db.Exec(
		`INSERT INTO contributions (id, timestamp, agent_name, role, content, contribution_type, related_to, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, ts.Format(time.RFC3339), body.AgentName, body.Role, body.Content, body.ContributionType, related, string(meta),
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	st := s.state
	s.saveState()
	s.mu.Unlock()

	contrib := Contribution{
		ID: id, Timestamp: ts, AgentName: body.AgentName, Role: body.Role,
		Content: body.Content, ContributionType: body.ContributionType,
		RelatedTo: body.RelatedTo, Metadata: body.Metadata,
	}
	s.hub.publish("contribution", contrib)
	s.hub.publish("state", st)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "ok"})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, timestamp, agent_name, role, content, contribution_type, related_to, metadata
		FROM contributions ORDER BY timestamp DESC LIMIT 50`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		AgentName string `json:"agent_name"`
		Role      string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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

func (s *Server) saveState() {
	data, _ := json.Marshal(s.state)
	s.db.Exec(`INSERT OR REPLACE INTO state (id, data) VALUES (1, ?)`, string(data))
}

func (s *Server) loadState() {
	var data string
	err := s.db.QueryRow(`SELECT data FROM state WHERE id = 1`).Scan(&data)
	if err == nil {
		json.Unmarshal([]byte(data), &s.state)
		if s.state.Roles == nil {
			s.state.Roles = make(map[string]string)
		}
	}
}
