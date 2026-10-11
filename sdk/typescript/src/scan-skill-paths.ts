import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveCodexProfile, type JsonObject } from "./config.js";
import { isRecord } from "./record.js";

/** Keep native skill injection out of the denied credential home. The scan
 * prompt loads the same workflow from CODEX_SECURITY_PLUGIN_ROOT instead. */
export async function scanSkillConfig(
  config: JsonObject,
  plugin: { pluginRoot: string; installedRoot: string },
  credentialHome: string,
): Promise<JsonObject> {
  const installed = relative(
    resolve(credentialHome),
    resolve(plugin.installedRoot),
  );
  if (
    isAbsolute(installed) ||
    installed === ".." ||
    installed.startsWith(`..${sep}`)
  ) {
    return config;
  }
  const skills = await readdir(join(plugin.pluginRoot, "skills"), {
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const paths = new Set(
    skills
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        join(plugin.installedRoot, "skills", entry.name, "SKILL.md"),
      ),
  );
  if (paths.size === 0) return config;
  const resolved = resolveCodexProfile(config);
  // Leave malformed user settings intact so native configuration reports them.
  if (resolved["skills"] !== undefined && !isRecord(resolved["skills"]))
    return config;
  const configured = isRecord(resolved["skills"]) ? resolved["skills"] : {};
  if (
    configured["config"] !== undefined &&
    !Array.isArray(configured["config"])
  )
    return config;
  const entries = Array.isArray(configured["config"])
    ? configured["config"]
    : [];
  const selection = {
    ...configured,
    config: [
      ...entries.filter(
        (entry) => !isRecord(entry) || !paths.has(String(entry["path"])),
      ),
      ...Array.from(paths, (path) => ({ path, enabled: false })),
    ],
  } as JsonObject;
  const updated = structuredClone(config);
  updated["skills"] = selection;
  const profiles = updated["profiles"];
  const profile =
    typeof updated["profile"] === "string" && isRecord(profiles)
      ? profiles[updated["profile"]]
      : undefined;
  if (isRecord(profile)) profile["skills"] = selection;
  return updated;
}
