package main

// Shared request bodies with correct json tags (snake_case from the UI).

type knowledgeBody struct {
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	Kind      string `json:"kind"`
}

type artifactBody struct {
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Content   string `json:"content"`
}

type projectBody struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Rules       string `json:"rules"`
}
