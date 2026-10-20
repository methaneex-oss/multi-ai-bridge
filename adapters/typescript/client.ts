/**
 * TypeScript client for the Multi-AI Bridge
 */

export type ContributionType =
  | "plan"
  | "code"
  | "review"
  | "test"
  | "critique"
  | "decision"
  | "question"
  | "answer"
  | "status"
  | "update";

export interface SharedState {
  task_title?: string;
  task_description?: string;
  goals?: string[];
  constraints?: string[];
  roles?: Record<string, string>;
  open_questions?: string[];
  decisions?: string[];
  current_status?: string;
  last_updated?: string;
  version?: number;
}

export interface Contribution {
  id: string;
  timestamp: string;
  agent_name: string;
  role: string;
  content: string;
  contribution_type: string;
  related_to?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BridgeClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export class BridgeClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: BridgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:8080").replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (options.apiKey) {
      this.headers["X-API-Key"] = options.apiKey;
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...init?.headers },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bridge ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  health() {
    return this.request<{ status: string; service: string }>("/health");
  }

  getState() {
    return this.request<SharedState>("/api/v1/state");
  }

  setTask(title: string, description: string, goals: string[] = [], constraints: string[] = []) {
    return this.request<SharedState>("/api/v1/task", {
      method: "POST",
      body: JSON.stringify({ title, description, goals, constraints }),
    });
  }

  contribute(params: {
    agentName: string;
    role: string;
    content: string;
    contributionType?: ContributionType;
    relatedTo?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{ id: string; status: string }>("/api/v1/contribute", {
      method: "POST",
      body: JSON.stringify({
        agent_name: params.agentName,
        role: params.role,
        content: params.content,
        contribution_type: params.contributionType || "update",
        related_to: params.relatedTo ?? null,
        metadata: params.metadata || {},
      }),
    });
  }

  assignRole(agentName: string, role: string) {
    return this.request<SharedState>("/api/v1/role", {
      method: "POST",
      body: JSON.stringify({ agent_name: agentName, role }),
    });
  }

  getHistory(limit = 50) {
    return this.request<Contribution[]>(`/api/v1/history?limit=${limit}`);
  }

  getRoles() {
    return this.request<Record<string, string>>("/api/v1/roles");
  }
}
