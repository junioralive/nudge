import { Type, type FunctionDeclaration } from "@google/genai";
import { addTask, completeTask, deleteTask, isTodayInTimezone, listTasks, publicTask, updateTask } from "./data";
import { captureMemory, listRecentMemories, recallMemories } from "./secondBrain";
import { callEmailTool, consumeEmailApproval, createEmailApproval, readEmailReference, safeEmailAccounts, safeEmailList, safeEmailMessage } from "./email";
import { cancelAutomation, createAutomation, listAutomations, resolveEmailSchedule, retryAutomation } from "./automations";
import type { Env, TaskRow } from "./types";
import { listCalendarEvents } from "./calendar";
import {
  consumeWhatsAppApproval, consumeWhatsAppForwardApproval, consumeWhatsAppScheduleApproval,
  createWhatsAppApproval, createWhatsAppForwardApproval, createWhatsAppScheduleApproval,
  forwardWhatsAppMessage, getWhatsAppBriefing, getWhatsAppGroup, getWhatsAppMessages, listWhatsAppChats, listWhatsAppGroups,
  resolveWhatsAppRecipient, searchWhatsAppContacts, sendWhatsAppMessage,
  updateWhatsAppChat, updateWhatsAppMessage,
} from "./whatsapp";

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "brief_whatsapp",
    description: "Return bounded recent inbound WhatsApp updates since the last successful Nudge briefing. Use for an explicit general briefing such as 'brief me', 'catch me up', or 'what did I miss', as well as an explicit WhatsApp briefing. This reads only recent inbound messages and never marks them read.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        chatLimit: { type: Type.NUMBER, description: "Maximum recent chats to inspect. Default 8, maximum 12." },
        messagesPerChat: { type: Type.NUMBER, description: "Maximum inbound messages per chat. Default 5, maximum 10." },
      },
    },
  },
  {
    name: "list_whatsapp_chats",
    description: "Search WhatsApp chats and synced contacts by saved name or phone number. Results can include contacts with no recent conversation. Use only when the user explicitly asks about WhatsApp or a recipient must be selected. This does not read message bodies.",
    parameters: {
      type: Type.OBJECT,
      properties: { search: { type: Type.STRING }, limit: { type: Type.NUMBER } },
    },
  },
  {
    name: "search_whatsapp_contacts",
    description: "Search the synced WhatsApp address book by saved name or phone number, including contacts with no chat history. This never reads messages.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING }, limit: { type: Type.NUMBER } },
      required: ["query"],
    },
  },
  {
    name: "read_whatsapp_chat",
    description: "Read recent messages from one selected WhatsApp chat. Use only after an explicit request to open, read, summarize, or answer from that chat.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        jid: { type: Type.STRING }, limit: { type: Type.NUMBER }, search: { type: Type.STRING },
        startTime: { type: Type.STRING }, endTime: { type: Type.STRING }, mediaOnly: { type: Type.BOOLEAN }, fromMe: { type: Type.BOOLEAN },
      },
      required: ["jid"],
    },
  },
  {
    name: "list_whatsapp_groups",
    description: "List connected WhatsApp groups without reading their messages. Use only when the user explicitly asks about WhatsApp groups.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_whatsapp_group",
    description: "Get the name, topic, and participant list for one selected WhatsApp group. This does not read group messages or modify the group.",
    parameters: { type: Type.OBJECT, properties: { jid: { type: Type.STRING } }, required: ["jid"] },
  },
  {
    name: "update_whatsapp_message_state",
    description: "React to, mark read, star, or unstar one known WhatsApp message after an explicit user request. Reactions are visible to chat participants; never infer one without the user specifying it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, enum: ["react", "mark_read", "star", "unstar"] },
        jid: { type: Type.STRING }, messageId: { type: Type.STRING }, emoji: { type: Type.STRING },
      },
      required: ["action", "jid", "messageId"],
    },
  },
  {
    name: "update_whatsapp_chat_state",
    description: "Archive, unarchive, pin, or unpin one WhatsApp chat after the user explicitly requests that exact reversible action.",
    parameters: {
      type: Type.OBJECT,
      properties: { action: { type: Type.STRING, enum: ["archive", "unarchive", "pin", "unpin"] }, jid: { type: Type.STRING } },
      required: ["action", "jid"],
    },
  },
  {
    name: "prepare_whatsapp_message",
    description: "Prepare an exact WhatsApp recipient and message for verbal confirmation. Read the recipient and message back, then wait for an explicit yes/confirm/send before calling send_whatsapp_message. Never treat the original compose request as confirmation.",
    parameters: {
      type: Type.OBJECT,
      properties: { jid: { type: Type.STRING }, recipient: { type: Type.STRING }, message: { type: Type.STRING } },
      required: ["message"],
    },
  },
  {
    name: "send_whatsapp_message",
    description: "Send the previously prepared WhatsApp message. Call only after the user explicitly confirms the exact prepared recipient and message in a later turn. Never call in the same turn as prepare_whatsapp_message.",
    parameters: {
      type: Type.OBJECT,
      properties: { approval: { type: Type.STRING, description: "The signed approval returned by prepare_whatsapp_message." } },
      required: ["approval"],
    },
  },
  {
    name: "prepare_whatsapp_schedule",
    description: "Prepare a WhatsApp message and future delivery time for explicit confirmation. Read back the exact recipient, message, date, time, and timezone, then wait for a later yes/confirm/schedule before calling schedule_whatsapp_message.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        jid: { type: Type.STRING },
        recipient: { type: Type.STRING },
        message: { type: Type.STRING },
        scheduled_at: { type: Type.STRING, description: "Future ISO 8601 datetime with an explicit timezone offset." },
      },
      required: ["message", "scheduled_at"],
    },
  },
  {
    name: "schedule_whatsapp_message",
    description: "Create the previously prepared WhatsApp automation. Call only after explicit confirmation in a later user turn. This schedules an automation, not a task.",
    parameters: {
      type: Type.OBJECT,
      properties: { approval: { type: Type.STRING, description: "Signed approval returned by prepare_whatsapp_schedule." } },
      required: ["approval"],
    },
  },
  {
    name: "list_automations",
    description: "List WhatsApp and email automations with source, date, and status filters. Automations are not tasks.",
    parameters: { type: Type.OBJECT, properties: { source: { type: Type.STRING, enum: ["whatsapp", "email", "all"] }, status: { type: Type.STRING }, from: { type: Type.STRING }, to: { type: Type.STRING }, limit: { type: Type.NUMBER } } },
  },
  {
    name: "cancel_automation",
    description: "Cancel one known pending or failed automation after the user explicitly asks to cancel it. Obtain its ID with list_automations when needed.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER }, source: { type: Type.STRING, enum: ["whatsapp", "email"] } }, required: ["id"] },
  },
  {
    name: "retry_automation",
    description: "Manually retry one failed or delivery-unknown automation only after the user explicitly requests it. Warn that delivery-unknown email may already have been sent.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER }, source: { type: Type.STRING, enum: ["whatsapp", "email"] } }, required: ["id"] },
  },
  {
    name: "prepare_whatsapp_forward",
    description: "Prepare forwarding one known WhatsApp message to an exact recipient. Read back the destination and wait for explicit confirmation before calling forward_whatsapp_message.",
    parameters: {
      type: Type.OBJECT,
      properties: { messageId: { type: Type.STRING }, jid: { type: Type.STRING }, recipient: { type: Type.STRING } },
      required: ["messageId"],
    },
  },
  {
    name: "forward_whatsapp_message",
    description: "Forward the previously prepared WhatsApp message. Call only after explicit confirmation in a later turn.",
    parameters: { type: Type.OBJECT, properties: { approval: { type: Type.STRING } }, required: ["approval"] },
  },
  {
    name: "list_calendar_events",
    description: "List read-only calendar meetings and events in an explicit date range. Use when the user asks about their schedule, meetings, availability, or calendar. Calendar events are not tasks or memories.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, description: "ISO 8601 range start with timezone offset." },
        to: { type: Type.STRING, description: "ISO 8601 range end with timezone offset." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "list_email_accounts",
    description: "List the user's connected email accounts and send availability. Use only when the user explicitly asks about email or an account must be selected for a requested email action.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "list_email_inbox",
    description: "List header-only inbox summaries across all or selected email accounts. Returns sender, subject, date, read state, and an opaque message reference without reading message bodies. Use only for an explicit inbox or email briefing request.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        accountIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        limit: { type: Type.NUMBER },
      },
    },
  },
  {
    name: "search_email",
    description: "Search connected mailboxes for header-only email summaries. Use only when the user explicitly asks about email. This does not read message bodies or modify messages.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        accountIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        limit: { type: Type.NUMBER },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read one email body using the opaque ref returned by an email list or search. Call only when the user explicitly asks to open, read, explain, or summarize that specific message. Never fetch bodies for a general inbox briefing.",
    parameters: {
      type: Type.OBJECT,
      properties: { ref: { type: Type.STRING } },
      required: ["ref"],
    },
  },
  {
    name: "prepare_email_draft",
    description: "Prepare a proposed new email or reply for visible user review. This does not create or send a mailbox draft. Use only after the user explicitly asks to write or reply. The user must review the proposal in Nudge before it can be saved or sent.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        accountId: { type: Type.STRING },
        replyToRef: { type: Type.STRING },
        to: { type: Type.STRING },
        cc: { type: Type.STRING },
        subject: { type: Type.STRING },
        text: { type: Type.STRING },
        replyAll: { type: Type.BOOLEAN },
      },
      required: ["text"],
    },
  },
  {
    name: "prepare_email_schedule",
    description: "Prepare an exact plain-text email and future delivery time for confirmation. Read back sending account, To, Cc, Bcc, subject, body, date, time, and timezone. Wait for explicit confirmation in a later turn before schedule_email.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        accountId: { type: Type.STRING }, to: { type: Type.ARRAY, items: { type: Type.STRING } }, cc: { type: Type.ARRAY, items: { type: Type.STRING } }, bcc: { type: Type.ARRAY, items: { type: Type.STRING } }, subject: { type: Type.STRING }, body: { type: Type.STRING }, scheduled_at: { type: Type.STRING, description: "Future ISO 8601 datetime with an explicit timezone offset." },
      },
      required: ["to", "subject", "body", "scheduled_at"],
    },
  },
  {
    name: "schedule_email",
    description: "Create the previously prepared email automation after explicit confirmation in a later user turn. This is an automation, not a task.",
    parameters: { type: Type.OBJECT, properties: { approval: { type: Type.STRING } }, required: ["approval"] },
  },
  {
    name: "create_task_from_email",
    description: "Create a Nudge task linked to an email using its opaque ref. Use only when the user explicitly asks to turn that email into a task. Preserve the user's requested task details and due time.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ref: { type: Type.STRING },
        title: { type: Type.STRING },
        details: { type: Type.STRING },
        due_at: { type: Type.STRING },
        workspace: { type: Type.STRING },
      },
      required: ["ref", "title"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List the user's exact task state. By default return open tasks for today, overdue, or all. Use filter completed only when the user explicitly asks about finished work or task history. Completed tasks are not memories.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: { type: Type.STRING, enum: ["today", "overdue", "all", "completed"] },
        workspace: { type: Type.STRING, description: "Optional workspace. Omit for all workspaces." },
        query: { type: Type.STRING, description: "Optional text to search in task titles/details." },
        completed_after: { type: Type.STRING, description: "For completed history only: ISO 8601 lower bound for done_at, with timezone offset." },
        completed_before: { type: Type.STRING, description: "For completed history only: ISO 8601 upper bound for done_at, with timezone offset." },
      },
      required: ["filter"],
    },
  },
  {
    name: "add_task",
    description: "Create a task or scheduled nudge. Do not also save routine task state as a memory.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        title: { type: Type.STRING, description: "Short task title, maximum 200 characters." },
        details: { type: Type.STRING, description: "Preserve the user's complete explanation, constraints, and context. Do not summarize away meaningful details." },
        due_at: { type: Type.STRING, description: "ISO 8601 datetime with timezone offset." },
        workspace: { type: Type.STRING },
      },
      required: ["text"],
    },
  },
  {
    name: "update_task",
    description: "Update an existing task after finding its ID with list_tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.NUMBER },
        text: { type: Type.STRING },
        title: { type: Type.STRING },
        details: { type: Type.STRING },
        due_at: { type: Type.STRING },
        workspace: { type: Type.STRING },
      },
      required: ["id"],
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done after finding its ID with list_tasks.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER } }, required: ["id"] },
  },
  {
    name: "delete_task",
    description: "Permanently delete a task after finding its ID and confirming user intent.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.NUMBER } }, required: ["id"] },
  },
  {
    name: "remember_memory",
    description:
      "Store durable personal context. Use for explicit remember requests and clear preferences, decisions, relationships, or project facts. Never store credentials, raw transcripts, routine task state, assistant output, or transient chat. Confirm what was saved after success.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING },
        workspace: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["content"],
    },
  },
  {
    name: "recall_memory",
    description:
      "Search personal memory when an answer depends on preferences, people, history, or past decisions. Do not use for simple task operations.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        workspace: { type: Type.STRING },
        topK: { type: Type.NUMBER },
      },
      required: ["query"],
    },
  },
  {
    name: "list_recent_memories",
    description: "Browse recent memories, optionally within one workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        workspace: { type: Type.STRING },
        limit: { type: Type.NUMBER },
      },
    },
  },
];

function compactTask(task: TaskRow) {
  return {
    id: task.id,
    text: task.text,
    details: task.details,
    due_at: task.due_at,
    workspace: task.workspace,
    done_at: task.done_at,
  };
}

function inCompletionRange(value: string, after?: unknown, before?: unknown): boolean {
  const completedAt = new Date(value).getTime();
  if (Number.isNaN(completedAt)) return false;
  if (after !== undefined && after !== null && after !== "") {
    const lower = new Date(String(after)).getTime();
    if (Number.isNaN(lower)) throw new Error("completed_after must be a valid ISO 8601 datetime");
    if (completedAt < lower) return false;
  }
  if (before !== undefined && before !== null && before !== "") {
    const upper = new Date(String(before)).getTime();
    if (Number.isNaN(upper)) throw new Error("completed_before must be a valid ISO 8601 datetime");
    if (completedAt > upper) return false;
  }
  return true;
}

function normalizeToolDue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("due_at must be an ISO 8601 datetime with timezone");
  return date.toISOString();
}

export async function runTool(env: Env, name: string, args: Record<string, any>): Promise<any> {
  if (name === "brief_whatsapp") {
    try {
      return await getWhatsAppBriefing(env, {
        chatLimit: Math.min(Number(args.chatLimit) || 8, 12),
        messagesPerChat: Math.min(Number(args.messagesPerChat) || 5, 10),
      });
    }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "search_whatsapp_contacts") {
    try { return { contacts: await searchWhatsAppContacts(env, args.query, Math.min(Number(args.limit) || 10, 50)) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "list_whatsapp_chats") {
    try { return await listWhatsAppChats(env, { search: args.search, limit: Math.min(Number(args.limit) || 10, 25) }); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "read_whatsapp_chat") {
    try {
      return await getWhatsAppMessages(env, args.jid, {
        limit: Math.min(Number(args.limit) || 20, 50), search: args.search, startTime: args.startTime, endTime: args.endTime,
        mediaOnly: args.mediaOnly === undefined ? undefined : Boolean(args.mediaOnly),
        fromMe: args.fromMe === undefined ? undefined : Boolean(args.fromMe),
      });
    }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "list_whatsapp_groups") {
    try { return { groups: await listWhatsAppGroups(env) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "get_whatsapp_group") {
    try { return await getWhatsAppGroup(env, args.jid); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
  }
  if (name === "update_whatsapp_message_state") {
    if (!args.action || !args.jid || !args.messageId) return { ok: false, error: "action, jid, and messageId are required" };
    try { return await updateWhatsAppMessage(env, { action: args.action, jid: args.jid, messageId: args.messageId, emoji: args.emoji }); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not update WhatsApp message" }; }
  }
  if (name === "update_whatsapp_chat_state") {
    if (!args.action || !args.jid) return { ok: false, error: "action and jid are required" };
    try { return await updateWhatsAppChat(env, { action: args.action, jid: args.jid }); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not update WhatsApp chat" }; }
  }
  if (name === "prepare_whatsapp_message") {
    if (!args.message?.trim()) return { ok: false, error: "message is required" };
    let jid = String(args.jid || "").slice(0, 240);
    let recipient = String(args.recipient || "").slice(0, 300);
    if (!jid && recipient) {
      try {
        const resolved = await resolveWhatsAppRecipient(env, recipient);
        if (!resolved.match) return { ok: false, error: resolved.candidates.length ? "Recipient is ambiguous" : "WhatsApp contact not found", candidates: resolved.candidates };
        jid = resolved.match.jid;
        recipient = resolved.match.name;
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" };
      }
    }
    if (!jid) return { ok: false, error: "recipient or chat is required" };
    try {
      const message = String(args.message).slice(0, 10_000);
      const approval = await createWhatsAppApproval(env, { jid, message });
      return { ok: true, requires_confirmation: true, approval, draft: { jid, recipient, message } };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not prepare WhatsApp message" };
    }
  }
  if (name === "send_whatsapp_message") {
    if (!args.approval) return { ok: false, error: "approval is required" };
    try {
      const approved = await consumeWhatsAppApproval(env, String(args.approval));
      return { ok: true, ...(await sendWhatsAppMessage(env, approved)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not send WhatsApp message" };
    }
  }
  if (name === "prepare_whatsapp_schedule") {
    if (!args.message?.trim() || !args.scheduled_at) return { ok: false, error: "message and scheduled_at are required" };
    let jid = String(args.jid || "").slice(0, 240);
    let recipient = String(args.recipient || "").slice(0, 300);
    if (!jid && recipient) {
      try {
        const resolved = await resolveWhatsAppRecipient(env, recipient);
        if (!resolved.match) return { ok: false, error: resolved.candidates.length ? "Recipient is ambiguous" : "WhatsApp contact not found", candidates: resolved.candidates };
        jid = resolved.match.jid;
        recipient = resolved.match.name;
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
    }
    if (!jid) return { ok: false, error: "recipient or chat is required" };
    try {
      const message = String(args.message).slice(0, 10_000);
      const approval = await createWhatsAppScheduleApproval(env, { jid, recipient, message, scheduledAt: args.scheduled_at });
      return { ok: true, requires_confirmation: true, approval, automation: { type: "whatsapp", recipient, message, scheduledAt: new Date(String(args.scheduled_at)).toISOString() } };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not prepare WhatsApp automation" }; }
  }
  if (name === "schedule_whatsapp_message") {
    if (!args.approval) return { ok: false, error: "approval is required" };
    try {
      const approved = await consumeWhatsAppScheduleApproval(env, String(args.approval));
      return { ok: true, automation: await createAutomation(env, "whatsapp_message", { jid: approved.jid, message: approved.message, recipient: approved.recipient }, approved.scheduledAt) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not schedule WhatsApp message" }; }
  }
  if (name === "list_automations") {
    try {
      return await listAutomations(env, { source: args.source === "all" ? undefined : String(args.source || ""), status: args.status ? String(args.status) : undefined, from: args.from ? String(args.from) : undefined, to: args.to ? String(args.to) : undefined, limit: Math.min(Number(args.limit) || 25, 100) });
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not list automations" }; }
  }
  if (name === "cancel_automation") {
    try { return { ok: true, ...(await cancelAutomation(env, args.id, args.source ? String(args.source) : undefined)) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not cancel automation" }; }
  }
  if (name === "retry_automation") {
    try { return { ok: true, ...(await retryAutomation(env, args.id, args.source ? String(args.source) : undefined)) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not retry automation" }; }
  }
  if (name === "prepare_whatsapp_forward") {
    if (!args.messageId) return { ok: false, error: "messageId is required" };
    let jid = String(args.jid || "").slice(0, 240);
    let recipient = String(args.recipient || "").slice(0, 300);
    if (!jid && recipient) {
      try {
        const resolved = await resolveWhatsAppRecipient(env, recipient);
        if (!resolved.match) return { ok: false, error: resolved.candidates.length ? "Recipient is ambiguous" : "WhatsApp contact not found", candidates: resolved.candidates };
        jid = resolved.match.jid;
        recipient = resolved.match.name;
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "WhatsApp unavailable" }; }
    }
    if (!jid) return { ok: false, error: "recipient or chat is required" };
    try {
      return { ok: true, requires_confirmation: true, approval: await createWhatsAppForwardApproval(env, { jid, messageId: args.messageId, recipient }), draft: { jid, recipient, messageId: String(args.messageId) } };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not prepare WhatsApp forward" }; }
  }
  if (name === "forward_whatsapp_message") {
    if (!args.approval) return { ok: false, error: "approval is required" };
    try {
      const approved = await consumeWhatsAppForwardApproval(env, String(args.approval));
      return { ok: true, ...(await forwardWhatsAppMessage(env, approved)) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not forward WhatsApp message" }; }
  }
  if (name === "list_calendar_events") {
    try {
      const events = await listCalendarEvents(env, { from: String(args.from || ""), to: String(args.to || "") });
      return {
        count: events.length,
        events: events.slice(0, 100).map((event) => ({
          title: event.title,
          starts_at: event.starts_at,
          ends_at: event.ends_at,
          all_day: event.all_day,
          location: event.location,
          calendar: event.calendar_name,
        })),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Calendar unavailable" };
    }
  }
  if (name === "list_email_accounts") {
    try {
      return { accounts: safeEmailAccounts(await callEmailTool(env, "email_list_accounts")) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Email service unavailable" };
    }
  }
  if (name === "list_email_inbox") {
    try {
      const result = await callEmailTool(env, "email_list_all_inbox_messages", {
        ...(Array.isArray(args.accountIds) && args.accountIds.length ? { accountIds: args.accountIds.map(String).slice(0, 20) } : {}),
        limit: Math.min(Math.max(Number(args.limit) || 10, 1), 25),
        sortOrder: "newest",
      });
      return safeEmailList(env, result, true);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Email service unavailable" };
    }
  }
  if (name === "search_email") {
    if (!args.query?.trim()) return { ok: false, error: "query is required" };
    try {
      return await callEmailTool(env, "email_search_all_accounts", {
        text: String(args.query).trim().slice(0, 300),
        folder: "INBOX",
        ...(Array.isArray(args.accountIds) && args.accountIds.length ? { accountIds: args.accountIds.map(String).slice(0, 20) } : {}),
        limit: Math.min(Math.max(Number(args.limit) || 10, 1), 25),
        sortOrder: "newest",
      }).then((result) => safeEmailList(env, result, true));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Email service unavailable" };
    }
  }
  if (name === "read_email") {
    if (!args.ref) return { ok: false, error: "ref is required" };
    try {
      const ref = await readEmailReference(env, String(args.ref));
      return { ok: true, message: safeEmailMessage(await callEmailTool(env, "email_get_message", { ...ref }), true) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Email service unavailable" };
    }
  }
  if (name === "prepare_email_draft") {
    if (!args.text?.trim()) return { ok: false, error: "text is required" };
    return {
      ok: true,
      requires_confirmation: true,
      draft: {
        accountId: String(args.accountId || "").slice(0, 160),
        replyToRef: String(args.replyToRef || "").slice(0, 8_000),
        to: String(args.to || "").slice(0, 1_000),
        cc: String(args.cc || "").slice(0, 1_000),
        subject: String(args.subject || "").slice(0, 1_000),
        text: String(args.text).slice(0, 50_000),
        replyAll: Boolean(args.replyAll),
      },
    };
  }
  if (name === "prepare_email_schedule") {
    try {
      const preview = await resolveEmailSchedule(env, args);
      return { ok: true, requires_confirmation: true, approval: await createEmailApproval(env, "schedule-send", preview), automation: preview };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not prepare email automation" }; }
  }
  if (name === "schedule_email") {
    if (!args.approval) return { ok: false, error: "approval is required" };
    try {
      const approved = await consumeEmailApproval(env, String(args.approval), "schedule-send");
      const payload = await resolveEmailSchedule(env, approved);
      return { ok: true, automation: await createAutomation(env, "email_message", { accountId: payload.accountId, accountName: payload.accountName, to: payload.to, cc: payload.cc, bcc: payload.bcc, subject: payload.subject, body: payload.body }, payload.scheduledAt) };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not schedule email" }; }
  }
  if (name === "create_task_from_email") {
    if (!args.ref || !args.title?.trim()) return { ok: false, error: "ref and title are required" };
    try {
      const ref = await readEmailReference(env, String(args.ref));
      const task = await addTask(env, {
        text: String(args.title).trim().slice(0, 200),
        details: String(args.details || "").slice(0, 10_000),
        due_at: normalizeToolDue(args.due_at) || null,
        workspace: String(args.workspace || "Personal").slice(0, 80),
      });
      await env.DB.prepare("INSERT INTO email_task_links (task_id, account_id, folder, message_uid, message_id) VALUES (?, ?, ?, ?, ?)")
        .bind(task.id, ref.accountId, ref.folder, ref.uid, ref.messageId || null).run();
      return { ok: true, task: compactTask(task) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not create email task" };
    }
  }
  if (name === "list_tasks") {
    const completed = args.filter === "completed";
    let rows = (await listTasks(env)).filter((task) => completed ? Boolean(task.done_at) : !task.done_at);
    if (args.workspace) {
      rows = rows.filter((task) => task.workspace.toLowerCase() === String(args.workspace).toLowerCase());
    }

    if (args.query) {
      const query = String(args.query).trim().toLowerCase();
      rows = rows.filter((task) => `${task.text}\n${task.details || ""}`.toLowerCase().includes(query));
    }

    let timezone = env.APP_TIMEZONE || "Asia/Kolkata";
    try {
      const saved = await env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
      if (saved?.value) timezone = saved.value;
    } catch {
      // Older test/local databases can safely fall back to the deployment timezone.
    }
    if (completed) {
      rows = rows.filter((task) => inCompletionRange(task.done_at!, args.completed_after, args.completed_before));
      rows.sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));
    } else if (args.filter === "today") {
      rows = rows.filter((task) => task.due_at && isTodayInTimezone(task.due_at, timezone));
    } else if (args.filter === "overdue") {
      rows = rows.filter((task) => task.due_at && new Date(task.due_at).getTime() < Date.now());
    }
    return { tasks: rows.map(compactTask), count: rows.length };
  }

  if (name === "add_task") {
    const title = (args.title || args.text || "").trim();
    if (!title) return { ok: false, error: "text is required" };
    const task = await addTask(env, {
      text: title,
      details: String(args.details || ""),
      due_at: normalizeToolDue(args.due_at) || null,
      workspace: args.workspace || "Personal",
    });
    return { ok: true, task: compactTask(task) };
  }

  if (name === "update_task") {
    const task = await updateTask(env, Number(args.id), {
      ...args,
      ...(args.title !== undefined ? { text: args.title } : {}),
      ...(args.due_at !== undefined ? { due_at: normalizeToolDue(args.due_at) } : {}),
    });
    return task ? { ok: true, task: compactTask(task) } : { ok: false, error: "task not found" };
  }

  if (name === "complete_task") {
    return { ok: Boolean(await completeTask(env, Number(args.id))) };
  }

  if (name === "delete_task") {
    return { ok: await deleteTask(env, Number(args.id)) };
  }

  if (name === "remember_memory") {
    if (!args.content?.trim()) return { ok: false, error: "content is required" };
    const result = await captureMemory(env, {
      content: args.content.trim(),
      workspace: args.workspace,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
    });
    return { ok: true, ...result, remembered: args.content.trim().slice(0, 180) };
  }

  if (name === "recall_memory") {
    if (!args.query?.trim()) return { ok: false, error: "query is required" };
    return recallMemories(env, {
      query: args.query.trim(),
      workspace: args.workspace,
      topK: Math.min(Number(args.topK) || 5, 10),
    });
  }

  if (name === "list_recent_memories") {
    return listRecentMemories(env, { workspace: args.workspace, limit: Math.min(Number(args.limit) || 10, 20) });
  }

  return { ok: false, error: `unknown tool ${name}` };
}
