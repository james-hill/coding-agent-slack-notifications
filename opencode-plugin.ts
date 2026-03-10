import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

interface Config {
  enabled: boolean
  port: string
  sound: boolean
  url: string
  payload?: string
}

function loadConfig(): Config {
  const config: Config = {
    enabled: true,
    port: "6789",
    sound: true,
    url: "",
  }

  const configPath =
    process.env.AGENT_NOTIFY_CONFIG ??
    join(homedir(), ".notify.yaml")

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
        case "port": config.port = value; break
        case "sound": config.sound = value !== "false"; break
        case "url": config.url = value; break
        case "payload": config.payload = value; break
      }
    }
  } catch {
    // Config file not found, use defaults
  }

  // Env vars override config
  config.port = process.env.AGENT_NOTIFY_PORT ?? config.port
  config.sound = process.env.AGENT_NOTIFY_SOUND !== undefined
    ? process.env.AGENT_NOTIFY_SOUND !== "false"
    : config.sound
  config.url = process.env.AGENT_NOTIFY_URL ?? (config.url || `http://localhost:${config.port}/notify`)

  return config
}

const config = loadConfig()

async function notify(title: string, message: string) {
  if (!config.enabled) return
  try {
    let body: string
    if (config.payload) {
      body = config.payload
        .replace(/\$\{title\}/g, title)
        .replace(/\$\{message\}/g, message)
        .replace(/\$\{sound\}/g, String(config.sound))
    } else {
      body = JSON.stringify({ title, message, sound: config.sound })
    }

    await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
  } catch {
    // Bridge not running, silently ignore
  }
}

console.log("[desktop-notifications] Plugin loaded")

export const DesktopNotificationsPlugin: Plugin = async () => {
  console.log("[desktop-notifications] Plugin initialized")
  return {
    event: async ({ event }) => {
      console.log("[desktop-notifications] event:", event.type)
      switch (event.type) {
        case "session.error":
          await notify("OpenCode Error", basename(process.cwd()))
          break
        case "permission.asked":
          await notify("OpenCode Needs Permission", basename(process.cwd()))
          break
      }
    },
  }
}
