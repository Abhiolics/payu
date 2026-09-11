/** Framework-neutral frontend helper. Set baseUrl from your frontend's public env variable.
 * Keep bearer tokens in memory or an appropriate secure native credential store.
 * A browser BFF can instead keep the token server-side and use a secure HttpOnly cookie.
 */
export type ApiEnvelope<T> = { success: true; data: T };
export type Page<T> = {
  items: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
};
export type Entity = { id: string; _id: string; createdAt: string };
export type User = Entity & {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: "user" | "admin";
  isVerified: boolean;
  isBlocked: boolean;
  isActive: boolean;
};
export type Wallet = {
  userId: string;
  balance: number;
  balancePaise: string | number;
};
export type Plan = Entity & {
  name: string;
  amount: number | string;
  description: string;
  isActive: boolean;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createPayClient(
  baseUrl: string,
  getToken: () => string | undefined,
) {
  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...options,
      headers,
    });
    const result = await response.json();
    if (!response.ok)
      throw new ApiError(
        response.status,
        result.error?.code || "HTTP_ERROR",
        result.error?.message || "Request failed",
      );
    return (result as ApiEnvelope<T>).data;
  }
  return {
    api,
    login: (email: string, password: string) =>
      api<{ token: string; user: User; expiresIn: number }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    me: () => api<User>("/auth/me"),
    plans: () => api<Page<Plan>>("/plans"),
    wallet: () => api<Wallet>("/wallet"),
    createDeposit: (
      input: {
        planId: string;
        transactionRef: string;
        amount: string;
        paymentProof: File;
      },
      key: string,
    ) => {
      const body = new FormData();
      Object.entries(input).forEach(([k, v]) => body.append(k, v));
      return api<Entity>("/deposits", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      });
    },
    async downloadProof(proofUrl: string) {
      // proofUrl is returned as /api/files/:id; baseUrl includes /api.
      if (!/^\/api\/files\/[0-9a-f]{24}$/.test(proofUrl))
        throw new Error("Invalid proof URL");
      const response = await fetch(
        `${baseUrl.replace(/\/api\/?$/, "")}${proofUrl}`,
        { headers: { Authorization: `Bearer ${getToken() || ""}` } },
      );
      if (!response.ok) throw new Error("Unable to download proof");
      return response.blob();
    },
  };
}
// const client = createPayClient('http://localhost:5003/api', () => sessionToken);
// Generate one crypto.randomUUID() per new monetary action. Keep the SAME key and
// exact body for network retries; generate a NEW key when the intended action changes.
