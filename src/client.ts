import { HindsightPluginConfig } from "./config.js";

export interface MentalModelItem {
  id: string;
  bank_id: string;
  name: string;
  source_query?: string | null;
  content?: string | null;
  tags?: string[];
  max_tokens?: number | null;
  last_refreshed_at?: string | null;
  last_memory_seen_at?: string | null;
  is_stale?: boolean | null;
  created_at?: string | null;
}

export interface MentalModelListResponse {
  items: MentalModelItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecallResult {
  id: string;
  text: string;
  context?: string | null;
  type?: string | null;
  entities?: string[];
  occurred_start?: string | null;
  occurred_end?: string | null;
}

export interface RecallResponse {
  results: RecallResult[];
  entities?: Record<string, any>;
  chunks?: Record<string, any>;
}

export interface RetainMemoryItem {
  content: string;
  context?: string | null;
  tags?: string[];
  timestamp?: string | null;
  document_id?: string | null;
  metadata?: Record<string, string> | null;
}

export interface RetainResponse {
  success?: boolean;
  items_count?: number;
  operation_id?: string;
}

export interface ReflectResponse {
  answer: string;
  based_on?: {
    facts?: any[];
    observations?: any[];
  };
}

export class HindsightClient {
  private apiUrl: string;
  private apiKey?: string;
  private bankId: string;
  private timeoutMs: number;

  constructor(config: HindsightPluginConfig, timeoutMs = 15000) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.bankId = config.bankId;
    this.timeoutMs = timeoutMs;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: any,
    timeoutMs?: number
  ): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Hindsight API error: ${method} ${endpoint} -> ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  public getBankId(): string {
    return this.bankId;
  }

  public setBankId(bankId: string): void {
    this.bankId = bankId;
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; database?: string }> {
    try {
      return await this.request<{ status: string; database?: string }>("GET", "/health", undefined, 5000);
    } catch {
      return { status: "unknown" };
    }
  }

  /**
   * List mental models stored for the configured bank, optionally filtered by tags
   */
  async listMentalModels(
    bankIdOrParams?:
      | string
      | {
          bankId?: string;
          detail?: "metadata" | "content" | "full";
          tags?: string[];
          tags_match?: "any" | "all" | "exact";
        },
    detailParam: "metadata" | "content" | "full" = "content"
  ): Promise<MentalModelListResponse> {
    let bankId = this.bankId;
    let detail = detailParam;
    let tags: string[] | undefined;
    let tags_match: "any" | "all" | "exact" = "any";

    if (typeof bankIdOrParams === "object" && bankIdOrParams !== null) {
      bankId = bankIdOrParams.bankId || this.bankId;
      detail = bankIdOrParams.detail || detailParam;
      tags = bankIdOrParams.tags;
      tags_match = bankIdOrParams.tags_match || "any";
    } else if (typeof bankIdOrParams === "string") {
      bankId = bankIdOrParams;
    }

    const encodedBank = encodeURIComponent(bankId);
    let queryParams = `detail=${encodeURIComponent(detail)}&limit=100`;

    if (tags && tags.length > 0) {
      for (const tag of tags) {
        queryParams += `&tags=${encodeURIComponent(tag)}`;
      }
      queryParams += `&tags_match=${encodeURIComponent(tags_match)}`;
    }

    return await this.request<MentalModelListResponse>(
      "GET",
      `/v1/default/banks/${encodedBank}/mental-models?${queryParams}`
    );
  }

  /**
   * Get a specific mental model by ID
   */
  async getMentalModel(
    mentalModelId: string,
    bankId = this.bankId,
    detail: "metadata" | "content" | "full" = "full"
  ): Promise<MentalModelItem> {
    const encodedBank = encodeURIComponent(bankId);
    const encodedId = encodeURIComponent(mentalModelId);
    return await this.request<MentalModelItem>(
      "GET",
      `/v1/default/banks/${encodedBank}/mental-models/${encodedId}?detail=${detail}`
    );
  }

  /**
   * Create a new mental model
   */
  async createMentalModel(params: {
    name: string;
    source_query: string;
    mental_model_id?: string;
    tags?: string[];
    max_tokens?: number;
    bank_id?: string;
  }): Promise<{ id: string; operation_id?: string }> {
    const bankId = params.bank_id || this.bankId;
    const encodedBank = encodeURIComponent(bankId);
    return await this.request<{ id: string; operation_id?: string }>(
      "POST",
      `/v1/default/banks/${encodedBank}/mental-models`,
      {
        name: params.name,
        source_query: params.source_query,
        mental_model_id: params.mental_model_id,
        tags: params.tags,
        max_tokens: params.max_tokens ?? 2048,
        trigger_refresh_after_consolidation: false
      }
    );
  }

  /**
   * Refresh a mental model
   */
  async refreshMentalModel(
    mentalModelId: string,
    bankId = this.bankId
  ): Promise<{ operation_id: string }> {
    const encodedBank = encodeURIComponent(bankId);
    const encodedId = encodeURIComponent(mentalModelId);
    return await this.request<{ operation_id: string }>(
      "POST",
      `/v1/default/banks/${encodedBank}/mental-models/${encodedId}/refresh`
    );
  }

  /**
   * Recall memories relevant to a query/topic
   */
  async recall(params: {
    query: string;
    budget?: "low" | "mid" | "high";
    max_tokens?: number;
    tags?: string[];
    tags_match?: "any" | "all" | "any_strict" | "all_strict" | "exact";
    bank_id?: string;
  }): Promise<RecallResponse> {
    const bankId = params.bank_id || this.bankId;
    const encodedBank = encodeURIComponent(bankId);
    return await this.request<RecallResponse>(
      "POST",
      `/v1/default/banks/${encodedBank}/memories/recall`,
      {
        query: params.query,
        budget: params.budget ?? "mid",
        max_tokens: params.max_tokens ?? 2048,
        tags: params.tags,
        tags_match: params.tags_match ?? "any"
      },
      10000
    );
  }


  /**
   * Retain memories into the bank (async by default)
   */
  async retain(
    items: RetainMemoryItem[],
    isAsync = true,
    bankId = this.bankId
  ): Promise<RetainResponse> {
    if (items.length === 0) {
      return { success: true, items_count: 0 };
    }
    const encodedBank = encodeURIComponent(bankId);
    return await this.request<RetainResponse>(
      "POST",
      `/v1/default/banks/${encodedBank}/memories`,
      {
        items,
        async: isAsync
      },
      15000
    );
  }

  /**
   * Reflect on memories
   */
  async reflect(
    query: string,
    budget: "low" | "mid" | "high" = "mid",
    bankId = this.bankId
  ): Promise<ReflectResponse> {
    const encodedBank = encodeURIComponent(bankId);
    return await this.request<ReflectResponse>(
      "POST",
      `/v1/default/banks/${encodedBank}/reflect`,
      {
        query,
        budget
      },
      30000
    );
  }
}
