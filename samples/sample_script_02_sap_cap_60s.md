# Episode CAP-01: Build an OData V4 Service in 45 Seconds

- **Target Persona:** Full-Stack & Cloud Developers
- **Tool:** VS Code / Terminal
- **Runtime:** 52 seconds (~132 words)

---

### [0:00 - 0:03] Phase 1: The Hook
- **Visual:** Presenter with stopwatch on screen. Bold text overlay: **"BUILD AN ENTERPRISE API IN 45 SECONDS ⏱️"**
- **Voiceover:** "Can you build a production-grade enterprise API in under 45 seconds? Let’s find out."
- **SFX:** Countdown clock ticking.

### [0:03 - 0:10] Phase 2: The Context / Pain Point
- **Visual:** Screen shows complex Java/Spring or classic gateway configuration screens.
- **Voiceover:** "Traditional enterprise backends take days of config, XML mapping, and database migrations."
- **SFX:** Whoosh.

### [0:10 - 0:38] Phase 3: The Solution (Live Execution)
- **Visual:** Split screen: Terminal on left, VS Code on right.
- **Step 1 (0:10 - 0:20):**
  - **Visual:** Terminal command typed:
    ```bash
    cds init inventory && cd inventory
    ```
  - **Voiceover:** "Step one: Run `cds init`. The SAP Cloud Application Programming model sets up your structure instantly."
- **Step 2 (0:20 - 0:30):**
  - **Visual:** Types inside `db/schema.cds`:
    ```cds
    entity Products { key ID: UUID; title: String; stock: Integer; }
    ```
  - **Voiceover:** "Step two: Define your entity in Core Data Services, and expose it in your service definition in two lines."
- **Step 3 (0:30 - 0:38):**
  - **Visual:** Runs:
    ```bash
    cds watch
    ```
  - **Voiceover:** "Step three: Run `cds watch`."

### [0:38 - 0:48] Phase 4: The Payoff
- **Visual:** Browser opens automatically at `localhost:4004`. Clicks `$metadata` — full OData V4 specification rendered with working Fiori preview.
- **Voiceover:** "Boom. Live reloading, in-memory SQLite database, full OData V4 endpoints, and a Fiori test UI ready to go."
- **SFX:** Success bell.

### [0:48 - 0:52] Phase 5: Call to Action & Seamless Loop
- **Visual:** Presenter back on screen.
- **Voiceover:** "No boilerplate, zero headache. Try this on your machine today, and tell me..."
- **Loop Anchor:** "...Can you build a production-grade enterprise API in under 45 seconds?"
