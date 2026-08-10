import type { MailAccount } from "./types";
import { decrypt, encrypt } from "../crypto";

const STORAGE_KEY = "mail/accounts/v1";

export type EmailStoreErrorCode = "storage_read" | "invalid_key" | "decryption" | "invalid_data";

export class EmailStoreError extends Error {
	constructor(public code: EmailStoreErrorCode) {
		super(`Email account store failed: ${code}`);
		this.name = "EmailStoreError";
	}
}

export class AccountStore {
	constructor(
		private kv: KVNamespace,
		private encryptionKey: string,
	) {}

	async list(): Promise<MailAccount[]> {
		let encoded: ArrayBuffer | null;
		try {
			encoded = await this.kv.get(STORAGE_KEY, "arrayBuffer");
		} catch {
			throw new EmailStoreError("storage_read");
		}
		if (!encoded) return [];
		let plaintext: ArrayBuffer;
		try {
			plaintext = await decrypt(encoded, this.encryptionKey);
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			throw new EmailStoreError(message.includes("CREDENTIAL_ENCRYPTION_KEY") ? "invalid_key" : "decryption");
		}
		try {
			const accounts = JSON.parse(new TextDecoder().decode(plaintext));
			if (!Array.isArray(accounts)) throw new Error("not an array");
			return accounts as MailAccount[];
		} catch {
			throw new EmailStoreError("invalid_data");
		}
	}

	async get(id?: string): Promise<MailAccount> {
		const accounts = await this.list();
		if (id) {
			const account = accounts.find((candidate) => candidate.id === id);
			if (!account) throw new Error(`Account ${id} not found`);
			return account;
		}
		if (accounts.length === 1) return accounts[0];
		if (accounts.length === 0) throw new Error("No email accounts configured");
		throw new Error("Multiple accounts configured; accountId is required");
	}

	async add(account: Omit<MailAccount, "id">): Promise<MailAccount> {
		const accounts = await this.list();
		const created = { ...account, id: crypto.randomUUID() };
		accounts.push(created);
		await this.save(accounts);
		return created;
	}

	async update(account: MailAccount): Promise<void> {
		const accounts = await this.list();
		const index = accounts.findIndex((candidate) => candidate.id === account.id);
		if (index < 0) throw new Error(`Account ${account.id} not found`);
		accounts[index] = account;
		await this.save(accounts);
	}

	async remove(id: string): Promise<void> {
		const accounts = await this.list();
		const remaining = accounts.filter((account) => account.id !== id);
		if (remaining.length === accounts.length) throw new Error(`Account ${id} not found`);
		await this.save(remaining);
	}

	private async save(accounts: MailAccount[]): Promise<void> {
		const plaintext = new TextEncoder().encode(JSON.stringify(accounts));
		await this.kv.put(STORAGE_KEY, await encrypt(plaintext, this.encryptionKey));
	}
}
