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
  {
    id: "calm",
    label: "Calm & reassuring",
    guidance:
      "Speak gently at a comfortable pace. Leave a little space between thoughts without whispering.",
    text: "Take a moment, and let's work through this together. We don't need to rush. First, we'll understand the question, then try one small step. There's time to check the result.",
  },
  {
    id: "comic",
    label: "Comic & playful",
    guidance:
      "Use a light smile and a small pause before the last line. Keep the joke natural instead of doing a character voice.",
    text: "I thought this would take five minutes. Then the error message invited three friends. Sound familiar? Let's fix one thing at a time. Even my coffee needs a support ticket today.",
  },
  {
    id: "upbeat",
    label: "Upbeat & enthusiastic",
    guidance:
      "Bring energy and a smile, with clear emphasis. Use your normal volume rather than shouting.",
    text: "We've got something exciting to try today! A small change can make a real difference. Ready to see it work? Let's jump in, check the result, and celebrate a little progress together.",
  },
  {
    id: "sad",
    label: "Sad & reflective",
    guidance:
      "Use a quieter, reflective delivery with gentle emphasis. Keep the words audible and avoid forcing tears or a whisper.",
    text: "Some days don't turn out the way we hoped. A plan changes, and we need a moment to find our footing. That's all right. We can pause, listen, and decide what comes next.",
  },
] as const;
