export type LeaderboardMetric = 'fattest_pigeon' | 'fastest_hawk_kill';

export interface LeaderboardEntry {
  username: string;
  value: number;
  created_at?: string;
}

interface SubmitPayload {
  username: string;
  metric: LeaderboardMetric;
  value: number;
  match_id?: string;
  round_number?: number;
}

export class LeaderboardService {
  private readonly baseUrl: string;
  private readonly anonKey: string;

  constructor() {
    this.baseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
    this.anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.anonKey.length > 0;
  }

  public sanitizeUsername(input: string): string {
    const trimmed = input.trim();
    const clean = trimmed.replace(/[^\w\- ]+/g, '').slice(0, 20);
    return clean.length > 0 ? clean : 'anon';
  }

  public async submit(entry: SubmitPayload): Promise<void> {
    if (!this.isConfigured()) return;
    const payload = {
      username: this.sanitizeUsername(entry.username),
      metric: entry.metric,
      value: entry.value,
      match_id: entry.match_id ?? null,
      round_number: entry.round_number ?? null,
    };

    const response = await fetch(`${this.baseUrl}/rest/v1/leaderboard_entries`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Leaderboard submit failed: ${response.status} ${text}`);
    }
  }

  public async fetchTop(metric: LeaderboardMetric, limit = 10): Promise<LeaderboardEntry[]> {
    if (!this.isConfigured()) return [];

    const orderDirection = metric === 'fastest_hawk_kill' ? 'asc' : 'desc';
    const url =
      `${this.baseUrl}/rest/v1/leaderboard_entries` +
      `?select=username,value,created_at` +
      `&metric=eq.${metric}` +
      `&order=value.${orderDirection}` +
      `&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Leaderboard fetch failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as Array<{ username: string; value: number; created_at?: string }>;
    return data.map((row) => ({
      username: this.sanitizeUsername(row.username),
      value: Number(row.value),
      created_at: row.created_at,
    }));
  }
}

