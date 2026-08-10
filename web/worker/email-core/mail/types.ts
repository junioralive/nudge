/** Bindings needed by the embedded mail service and MCP worker. */
export interface MailEnv {
	EMAIL_KV: KVNamespace;
	CREDENTIAL_ENCRYPTION_KEY: string;
	NUDGE_ENCRYPTION_KEY?: string;
	OUTLOOK_CLIENT_ID?: string;
	OUTLOOK_CLIENT_SECRET?: string;
	OUTLOOK_TENANT?: string;
	MCP_OBJECT?: DurableObjectNamespace;
}

export interface ServerConfig {
	host: string;
	port: number;
	secure: boolean;
}

export type AccountAuth =
	| { type: "password"; password: string }
	| {
			type: "oauth2";
			accessToken: string;
			refreshToken?: string;
			clientId?: string;
			tenant?: string;
			expiresAt?: number;
	  };

export interface MailAccount {
	id: string;
	name: string;
	email: string;
	imap: ServerConfig;
	smtp?: ServerConfig;
	auth: AccountAuth;
}
