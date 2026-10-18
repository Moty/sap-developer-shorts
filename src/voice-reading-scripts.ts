/** Original short passages for reference recordings, not voice-model training data. */
export const voiceReadingScripts = [
  {
    id: "conversational",
    label: "Warm conversation (recommended)",
    guidance:
      "Imagine explaining something to a colleague. Let the question sound like a question.",
    text: "Let's try something new together. I'll walk you through a quick example, then we'll check what changed. Does that sound good? Great, grab a coffee and let's begin.",
  },
  {
    id: "professional",
    label: "Professional explanation",
    guidance: "Use your everyday presentation voice, with calm emphasis on the key points.",
    text: "A useful explanation starts with a clear question. What are we trying to solve? Today, we'll compare two approaches, check the results, and choose a practical next step.",
  },
  {
    id: "developer",
    label: "SAP & developer walkthrough",
    guidance:
      "Read the spaced letters individually. Keep the same relaxed pace as the rest of the passage.",
    text: "Let's build a small service with S A P. First, define the data, then open the A P I. Can we see the products? Yes, the query works. Now let's check one more result.",
  },
  {
    id: "news",
    label: "News & announcements",
    guidance: "Sound interested and clear, as if sharing news with your team.",
    text: "Here's a quick update for your team. A new feature could simplify the way we work. What's changing, and who can try it? Let's look at the details before we decide.",
  },
  {
    id: "story",
    label: "Casual story",
    guidance: "Keep it light. Use a small change in expression for the question and the last line.",
    text: "This morning, I took a different path to the office. A bright blue bicycle rolled past the bakery. Was I late? Just a little, but the fresh bread was worth it.",
  },
] as const;
