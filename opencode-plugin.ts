import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

interface Config {
  enabled: boolean
  webhookUrl: string
  debounceSeconds: number
}

// Module-level client ref for logging — set on plugin init
let _client: any = null

function pluginLog(level: "info" | "warn" | "error", message: string) {
  if (_client) {
    _client.app.log({ body: { service: "slack-notifications", level, message } })
  }
}

function loadConfig(): Config {
  const config: Config = {
    enabled: false,
    webhookUrl: "",
    debounceSeconds: 10,
  }

  const configPath =
    process.env.AGENT_NOTIFY_CONFIG ??
    join(homedir(), ".config", "slack-notifications", "notify.yaml")

  try {
    const content = readFileSync(configPath, "utf-8")
    for (const line of content.split("\n")) {
      if (/^\s*#/.test(line) || !line.trim()) continue
      const match = line.match(/^(\w+)\s*:\s*(.+)$/)
      if (!match) continue
      const [, key, raw] = match
      const value = raw.replace(/^['"]|['"]$/g, "").trim()
      switch (key) {
        case "enabled": config.enabled = value !== "false"; break
        case "webhook_url": config.webhookUrl = value; break
        case "debounce_seconds": config.debounceSeconds = parseInt(value, 10) || 10; break
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      pluginLog("error", `Failed to read config: ${err}`)
    }
  }

  // Env vars override config
  config.webhookUrl = process.env.SLACK_NOTIFICATIONS_WEBHOOK ?? config.webhookUrl

  return config
}

async function getLastAssistantMessage(client: any, sessionId: string): Promise<string> {
  try {
    const response = await client.session.messages({ path: { id: sessionId } })
    const messages = response.data ?? response
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const role = msg.role ?? msg.info?.role
      if (role !== "assistant") continue
      const textParts = (msg.parts ?? []).filter((p: any) => p.type === "text")
      if (textParts.length > 0) {
        return textParts.map((p: any) => p.text ?? p.content ?? "").join("\n").trim()
      }
    }
  } catch (err) {
    pluginLog("error", `Failed to fetch session messages: ${err}`)
  }
  return ""
}

function truncate(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + "..." : text
}

const EVENT_ICONS: Record<string, string> = {
  "session.idle": "\u2705",
  "session.error": "\u274C",
  "permission.asked": "\u{1F4AC}",
}
const DEFAULT_ICON = "\u{1F514}"

async function notify(title: string, event: any, client?: any) {
  const config = loadConfig()
  if (!config.enabled || !config.webhookUrl) return
  try {
    const project = basename(process.cwd())
    const sessionId = event.properties?.sessionId ?? event.properties?.sessionID
    const icon = EVENT_ICONS[event.type] ?? DEFAULT_ICON

    let summary = ""
    if (client && sessionId) {
      const lastMessage = await getLastAssistantMessage(client, sessionId)
      if (lastMessage) {
        summary = truncate(lastMessage)
      }
    }

    const blocks: any[] = [
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `${icon}  *${title}*` },
          { type: "mrkdwn", text: project },
        ],
      },
    ]

    if (summary) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `\`\`\`${summary}\`\`\`` }
      })
    }

    const resp = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${title}: ${project}`,
        blocks,
      })
    })
    if (!resp.ok) {
      throw new Error(`Slack returned ${resp.status}: ${await resp.text()}`)
    }
  } catch (err) {
    pluginLog("error", `Failed to send notification: ${err}`)
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function cancelDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function debouncedNotify(title: string, event: any, client?: any) {
  const config = loadConfig()
  cancelDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    notify(title, event, client)
  }, config.debounceSeconds * 1000)
}

export const SlackNotificationsPlugin: Plugin = async ({ client }) => {
  _client = client
  pluginLog("info", "Plugin initialized")
  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.idle":
          debouncedNotify("OpenCode Session Completed", event, client)
          break
        case "session.error":
          debouncedNotify("OpenCode Error", event, client)
          break
        case "permission.asked":
          debouncedNotify("OpenCode Needs Permission", event, client)
          break
        case "message.created":
          // Only cancel if it's a user message (agent resuming work)
          if (event.properties?.role === "user") {
            cancelDebounce()
          }
          break
      }
    },
  }
}
