import type { Config } from "./config.js";

const BASE_URLS = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com",
} as const;

export interface Candle {
  time: string;
  complete: boolean;
  volume: number;
  mid: { o: string; h: string; l: string; c: string };
}

export interface AccountSummary {
  balance: string;
  NAV: string;
  currency: string;
  openPositionCount: number;
  unrealizedPL: string;
}

export interface PositionSide {
  units: string;
  averagePrice?: string;
  unrealizedPL?: string;
}

export interface OpenPosition {
  instrument: string;
  long: PositionSide;
  short: PositionSide;
}

export class OandaError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`OANDA API error ${status} at ${url}: ${body}`);
  }
}

export class OandaClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(private config: Config) {
    this.baseUrl = BASE_URLS[config.env];
    this.headers = {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
      "Accept-Datetime-Format": "RFC3339",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new OandaError(res.status, text, url);
    }
    return JSON.parse(text) as T;
  }

  /** 直近のローソク足を取得 (mid価格) */
  async getCandles(instrument: string, granularity: string, count: number): Promise<Candle[]> {
    const params = new URLSearchParams({
      granularity,
      count: String(count),
      price: "M",
    });
    const data = await this.request<{ candles: Candle[] }>(
      "GET",
      `/v3/instruments/${instrument}/candles?${params}`
    );
    return data.candles;
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const data = await this.request<{ account: AccountSummary }>(
      "GET",
      `/v3/accounts/${this.config.accountId}/summary`
    );
    return data.account;
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
    const data = await this.request<{ positions: OpenPosition[] }>(
      "GET",
      `/v3/accounts/${this.config.accountId}/openPositions`
    );
    return data.positions;
  }

  /**
   * 成行注文を発注。unitsが正なら買い、負なら売り。
   * 損切り(SL)・利確(TP)を必ず同時に設定する。
   */
  async placeMarketOrder(
    instrument: string,
    units: number,
    stopLossPrice: number,
    takeProfitPrice: number,
    pricePrecision: number
  ): Promise<unknown> {
    const order = {
      order: {
        type: "MARKET",
        instrument,
        units: String(units),
        timeInForce: "FOK",
        positionFill: "DEFAULT",
        stopLossOnFill: { price: stopLossPrice.toFixed(pricePrecision) },
        takeProfitOnFill: { price: takeProfitPrice.toFixed(pricePrecision) },
      },
    };
    return this.request("POST", `/v3/accounts/${this.config.accountId}/orders`, order);
  }

  /** 指定通貨ペアのポジションを全決済 */
  async closePosition(instrument: string, side: "long" | "short"): Promise<unknown> {
    const body = side === "long" ? { longUnits: "ALL" } : { shortUnits: "ALL" };
    return this.request(
      "PUT",
      `/v3/accounts/${this.config.accountId}/positions/${instrument}/close`,
      body
    );
  }
}
