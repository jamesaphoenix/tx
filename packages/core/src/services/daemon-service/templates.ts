import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Default install path for the launchd plist file.
 * Located in the user's LaunchAgents directory for per-user daemons.
 */
export const LAUNCHD_PLIST_PATH = "~/Library/LaunchAgents/com.tx.daemon.plist"

/**
 * Default install path for the systemd service file.
 * Located in the user's systemd user directory for per-user services.
 */
export const SYSTEMD_SERVICE_PATH = "~/.config/systemd/user/tx-daemon.service"

/**
 * Options for generating a launchd plist file.
 */
export type LaunchdPlistOptions = {
  /**
   * The label for the launchd job (e.g., "com.tx.daemon").
   * This must be unique among all launchd jobs.
   */
  readonly label: string
  /**
   * The absolute path to the executable to run.
   */
  readonly executablePath: string
  /**
   * Optional path for log output (both stdout and stderr).
   * If not provided, defaults to ~/Library/Logs/tx-daemon.log
   */
  readonly logPath?: string
}

/**
 * Escape special characters for XML content.
 */
const escapeXml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

/**
 * Generate a macOS launchd plist file content.
 * Creates a valid XML plist that can be used with launchctl to run the daemon.
 *
 * The generated plist configures the daemon to:
 * - Run at load (start when user logs in)
 * - Keep alive (restart if it crashes)
 * - Log stdout and stderr to the specified log path
 *
 * @param options - Configuration options for the plist
 * @returns The XML content for the launchd plist file
 *
 * @example
 * ```typescript
 * const plist = generateLaunchdPlist({
 *   label: "com.tx.daemon",
 *   executablePath: "/usr/local/bin/tx",
 *   logPath: "~/Library/Logs/tx-daemon.log"
 * })
 * ```
 */
export const generateLaunchdPlist = (options: LaunchdPlistOptions): string => {
  const { label, executablePath, logPath } = options

  // Expand ~ to home directory for the log path
  const resolvedLogPath = logPath
    ? logPath.replace(/^~/, homedir())
    : join(homedir(), "Library", "Logs", "tx-daemon.log")

  // Generate valid XML plist
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(executablePath)}</string>
        <string>daemon</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(resolvedLogPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(resolvedLogPath)}</string>
</dict>
</plist>
`
}

/**
 * Options for generating a systemd service file.
 */
export type SystemdServiceOptions = {
  /**
   * The absolute path to the executable to run.
   */
  readonly executablePath: string
  /**
   * Optional user to run the service as.
   * If not provided, the service runs as the current user (for user services).
   */
  readonly user?: string
}

/**
 * Generate a Linux systemd service file content.
 * Creates a valid systemd unit file for a user service.
 *
 * The generated service file configures the daemon to:
 * - Start after the network is available
 * - Run as Type=simple (foreground process)
 * - Restart always on failure with 5 second delay
 * - Be enabled for multi-user target
 *
 * @param options - Configuration options for the service file
 * @returns The content for the systemd service file
 *
 * @example
 * ```typescript
 * const service = generateSystemdService({
 *   executablePath: "/usr/local/bin/tx",
 *   user: "myuser"
 * })
 * ```
 */
export const generateSystemdService = (options: SystemdServiceOptions): string => {
  const { executablePath, user } = options

  // Build the [Service] section lines
  const serviceLines = [
    "Type=simple",
    `ExecStart=${executablePath} daemon run`,
    "Restart=always",
    "RestartSec=5"
  ]

  // Add User= directive only if user is provided
  if (user) {
    serviceLines.push(`User=${user}`)
  }

  return `[Unit]
Description=tx Daemon - Task and memory management for AI agents
After=network.target

[Service]
${serviceLines.join("\n")}

[Install]
WantedBy=default.target
`
}
