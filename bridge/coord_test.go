package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := initDB(db); err != nil {
		t.Fatal(err)
	}
	migrateCoord(db)
	hub := newHub()
	go hub.run()
	s := &Server{db: db, hub: hub, state: State{Roles: map[string]string{}, CurrentStatus: "idle", LastUpdated: time.Now().UTC()}}
	return s
}

func TestEngineeringTaskCreateAndList(t *testing.T) {
	s := testServer(t)
	body := map[string]string{"title": "t1", "project_id": "p1", "objective": "o", "acceptance": "a", "owner": "arch", "status": "open"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/engineering-tasks", bytes.NewReader(b))
	w := httptest.NewRecorder()
	s.handleEngineeringTasks(w, req)
	if w.Code != 200 {
		t.Fatalf("create status %d body %s", w.Code, w.Body.String())
	}
	var created EngineeringTask
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == "" {
		t.Fatalf("bad create response: %s", w.Body.String())
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/engineering-tasks?project_id=p1", nil)
	w2 := httptest.NewRecorder()
	s.handleEngineeringTasks(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("list status %d", w2.Code)
	}
	var list []EngineeringTask
	_ = json.Unmarshal(w2.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Title != "t1" {
		t.Fatalf("expected 1 task, got %#v", list)
	}
}

func TestEngineeringTaskRejectsEmptyTitle(t *testing.T) {
	s := testServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/engineering-tasks", bytes.NewReader([]byte("{}")))
	w := httptest.NewRecorder()
	s.handleEngineeringTasks(w, req)
	if w.Code != 400 {
		t.Fatalf("want 400 got %d", w.Code)
	}
}

func TestMemoryCreateAndContextEnrich(t *testing.T) {
	s := testServer(t)
	pb, _ := json.Marshal(map[string]string{"name": "p", "rules": "r"})
	pr := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(pb))
	pw := httptest.NewRecorder()
	s.handleProjects(pw, pr)
	var proj Project
	_ = json.Unmarshal(pw.Body.Bytes(), &proj)
	if proj.ID == "" {
		t.Fatal("no project id")
	}
	tb, _ := json.Marshal(map[string]string{"title": "work", "project_id": proj.ID, "status": "open"})
	tr := httptest.NewRequest(http.MethodPost, "/api/v1/engineering-tasks", bytes.NewReader(tb))
	tw := httptest.NewRecorder()
	s.handleEngineeringTasks(tw, tr)
	mb, _ := json.Marshal(map[string]string{"project_id": proj.ID, "kind": "decision", "content": "use evidence", "confidence": "verified", "provenance": "test"})
	mr := httptest.NewRequest(http.MethodPost, "/api/v1/memory", bytes.NewReader(mb))
	mw := httptest.NewRecorder()
	s.handleMemory(mw, mr)
	if mw.Code != 200 {
		t.Fatalf("memory %d %s", mw.Code, mw.Body.String())
	}
	cr := httptest.NewRequest(http.MethodGet, "/api/v1/context?project_id="+proj.ID, nil)
	cw := httptest.NewRecorder()
	s.handleContext(cw, cr)
	var ctx map[string]interface{}
	_ = json.Unmarshal(cw.Body.Bytes(), &ctx)
	pack, _ := ctx["pack"].(string)
	if pack == "" {
		t.Fatal("empty pack")
	}
	if !contains(pack, "OPEN ENGINEERING TASKS") && !contains(pack, "work") {
		t.Fatalf("pack missing tasks: %s", pack)
	}
	if !contains(pack, "PROJECT MEMORY") && !contains(pack, "use evidence") {
		t.Fatalf("pack missing memory: %s", pack)
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	s := testServer(t)
	mb, _ := json.Marshal(map[string]string{"kind": "fact", "content": "roundtrip", "confidence": "unverified", "provenance": "test"})
	mr := httptest.NewRequest(http.MethodPost, "/api/v1/memory", bytes.NewReader(mb))
	mw := httptest.NewRecorder()
	s.handleMemory(mw, mr)
	er := httptest.NewRequest(http.MethodGet, "/api/v1/export", nil)
	ew := httptest.NewRecorder()
	s.handleExport(ew, er)
	if ew.Code != 200 {
		t.Fatalf("export %d", ew.Code)
	}
	s2 := testServer(t)
	ir := httptest.NewRequest(http.MethodPost, "/api/v1/import", bytes.NewReader(ew.Body.Bytes()))
	iw := httptest.NewRecorder()
	s2.handleImport(iw, ir)
	if iw.Code != 200 {
		t.Fatalf("import %d %s", iw.Code, iw.Body.String())
	}
	lr := httptest.NewRequest(http.MethodGet, "/api/v1/memory", nil)
	lw := httptest.NewRecorder()
	s2.handleMemory(lw, lr)
	var list []MemoryEntry
	_ = json.Unmarshal(lw.Body.Bytes(), &list)
	if len(list) < 1 {
		t.Fatalf("expected imported memory, got %v", list)
	}
}

func contains(s, sub string) bool {
	return indexOf(s, sub) >= 0
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
