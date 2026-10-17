// Compile separate v2 schemas without changing legacy schema files or records.
export function clonedEpisodeSchema(legacy: Record<string, unknown>) {
  const schema = JSON.parse(JSON.stringify(legacy));
  schema.$id = schema.$id.replace(".schema.json", "-v2.schema.json");
  schema.properties.schemaVersion = { const: 2 };
  schema.definitions.presentation.properties.speakers.items.properties.voice = {
    oneOf: [
      { type: "string", minLength: 1 },
      {
        type: "object",
        additionalProperties: false,
        required: ["engine", "profileId", "revision"],
        properties: {
          engine: { const: "qwen" },
          profileId: {
            type: "string",
            pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
          },
          revision: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      },
    ],
  };
  return schema;
}
export function clonedNewsSchema(legacy: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(legacy).replaceAll("episode.schema.json", "episode-v2.schema.json"),
  );
}
