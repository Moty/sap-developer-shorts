import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { ContentEpisode } from "../domain.js";
import { sourceFile } from "../paths.js";
import { episodeSelector, variantFile } from "../presentation.js";
import type { ProductionSettings } from "./model.js";
import { kokoroVoice } from "./voices.js";
import { validateProductionSettings } from "./worker.js";

export function effectiveNarrators(episode: ContentEpisode, settings: ProductionSettings) {
  const explicit = episode.presentation?.speakers;
  return {
    selector: episodeSelector(episode),
    source: explicit ? "presentation" : "default",
    speakers: explicit ?? [
      { id: "narrator", name: "Narrator", voice: settings.localPreview.voice },
    ],
    configurationFile: episode.presentation?.variant
      ? variantFile(episodeSelector(episode))
      : explicit
        ? `content/episodes/${episode.id}.json`
        : "config/production.json",
  };
}

export async function selectNarrator(
  voiceId: string,
  filename?: string,
): Promise<{ previous: string; selected: string }> {
  kokoroVoice(voiceId);
  const path = filename ?? (await sourceFile("config/production.json"));
  const original = await readFile(path, "utf8");
  const settings = validateProductionSettings(JSON.parse(original));
  if (settings.localPreview.engine !== "kokoro")
    throw new Error("Voice selection requires localPreview.engine to be kokoro.");
  const previous = settings.localPreview.voice;
  if (previous === voiceId) return { previous, selected: voiceId };
  settings.localPreview.voice = voiceId;
  validateProductionSettings(settings);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx" });
    if ((await readFile(path, "utf8")) !== original)
      throw new Error("Production settings changed while selecting a voice; try again.");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return { previous, selected: voiceId };
}
