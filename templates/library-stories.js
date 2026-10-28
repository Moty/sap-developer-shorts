(() => {
  // Mirrors src/library-stories.ts (grouping rules) for live workflow updates in the browser.
  // tests/library-stories.test.ts runs both implementations against the same fixtures.
  const order = ["producing", "review", "publish", "editing", "published"];
  const rank = (stage) => order.indexOf(stage);
  const stamp = (value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const natural = (a, b) => {
    const [baseA = "", variantA] = a.split("@");
    const [baseB = "", variantB] = b.split("@");
    return (
      baseA.localeCompare(baseB, "en", { numeric: true }) ||
      Number(variantA !== undefined) - Number(variantB !== undefined) ||
      (variantA ?? "").localeCompare(variantB ?? "", "en", { numeric: true })
    );
  };
  const chronological = (versions) =>
    [...versions].sort(
      (a, b) => stamp(a.updatedAt) - stamp(b.updatedAt) || natural(a.selector, b.selector),
    );
  const versionLabels = (versions) =>
    new Map(chronological(versions).map((version, index) => [version.selector, `v${index + 1}`]));
  // A video awaiting review is superseded once a newer version is approved or published.
  function activeVersions(versions) {
    const settled = Math.max(
      Number.NEGATIVE_INFINITY,
      ...versions
        .filter((version) => version.stage === "publish" || version.stage === "published")
        .map((version) => stamp(version.updatedAt)),
    );
    return versions.filter(
      (version) => version.stage !== "review" || stamp(version.updatedAt) >= settled,
    );
  }
  function pickRepresentative(versions) {
    const ordered = chronological(activeVersions(versions));
    return ordered.reduce((best, version) => {
      const difference = rank(version.stage) - rank(best.stage);
      if (difference !== 0) return difference < 0 ? version : best;
      return stamp(version.updatedAt) >= stamp(best.updatedAt) ? version : best;
    }, ordered[0]);
  }
  function workAction(stage, selector, options = {}) {
    const prefix = `episodes/${encodeURIComponent(selector)}`;
    if (stage === "producing")
      return { label: "View progress", shortLabel: "Progress", href: "#studio-produce-banner" };
    if (stage === "review")
      return { label: "Review video", shortLabel: "Review", href: `${prefix}/publish.html` };
    if (stage === "publish")
      return { label: "Finish publishing", shortLabel: "Finish", href: `${prefix}/publish.html` };
    if (stage === "published")
      return { label: "View publication", shortLabel: "View", href: `${prefix}/publish.html` };
    return options.blocked
      ? { label: "Fix saved version", shortLabel: "Fix", href: `${prefix}/edit.html` }
      : { label: "Continue editing", shortLabel: "Edit", href: `${prefix}/edit.html` };
  }
  const nextHint = {
    editing: "Script saved · continue when ready",
    producing: "Running on this Mac",
    review: "Video produced · awaiting your review",
    publish: "Approved · ready to post",
    published: "Live post link recorded",
  };

  // --- DOM bridge: version rows are the source of truth; the story row mirrors the representative.
  function readVersion(row) {
    const data = row.dataset;
    return {
      selector: data.selector,
      stage: data.stage,
      updatedAt: data.updated || "",
      attention: data.attention === "true",
      label: data.label || "",
      next: data.next || "",
      issue: data.issue || "",
      productionStage: data.productionStage || "",
      actionLabel: data.actionLabel || "",
      actionHref: data.actionHref || "",
      validThrough: data.validThrough || "",
      sourcesExpired: data.sourcesExpired === "true",
      versionLabel: data.versionLabel || "",
      title: data.title || "",
      news: data.news === "true",
    };
  }

  function applyWorkflowState(row, state) {
    const data = row.dataset;
    const stopped = state.productionStage === "BLOCKED" || state.productionStage === "FAILED";
    const action = workAction(state.stage, state.selector, {
      blocked: state.productionStage === "BLOCKED",
    });
    data.stage = state.stage;
    data.attention = String(state.attention);
    data.label = state.label;
    data.next = stopped
      ? "No MP4 yet · open this saved version to resolve the issue"
      : nextHint[state.stage];
    if (state.issue) data.issue = state.issue;
    else if (!state.attention) data.issue = "";
    data.productionStage = state.productionStage || "";
    data.actionLabel = action.label;
    data.shortLabel = action.shortLabel;
    data.actionHref = action.href;
    renderVersionRow(row);
  }

  function renderVersionRow(row) {
    const data = row.dataset;
    const badge = row.querySelector("[data-version-stage]");
    if (badge) {
      badge.textContent = data.label;
      badge.dataset.badge = data.stage;
    }
    const action = row.querySelector("[data-version-action]");
    if (action) {
      action.textContent = data.shortLabel || data.actionLabel;
      action.href = data.actionHref;
      action.setAttribute(
        "aria-label",
        `${data.actionLabel} · ${data.versionLabel || data.selector}`,
      );
    }
    const issue = row.querySelector("[data-version-issue]");
    if (issue) {
      issue.hidden = !data.issue;
      issue.textContent = data.issue;
    }
  }

  // Updates the story row from its versions: stage pill, hint, primary action and More menu.
  function syncStory(story) {
    const rows = [...story.querySelectorAll("[data-version]")];
    if (!rows.length) return null;
    const versions = rows.map(readVersion);
    const representative = pickRepresentative(versions);
    const repRow = rows.find((row) => row.dataset.selector === representative.selector);
    story.dataset.stages = order
      .filter((stage) => activeVersions(versions).some((v) => v.stage === stage))
      .join(" ");
    story.dataset.attention = String(versions.some((v) => v.attention));
    const badge = story.querySelector("[data-work-stage]");
    if (badge) {
      badge.textContent = representative.label;
      badge.dataset.badge = representative.stage;
    }
    const next = story.querySelector("[data-work-next]");
    if (next) next.textContent = representative.next;
    const action = story.querySelector("[data-work-action]");
    if (action) {
      action.textContent = representative.actionLabel;
      action.href = representative.actionHref;
    }
    const flagged = versions
      .filter((version) => version.attention && version.issue)
      .sort((a, b) =>
        a.selector === representative.selector
          ? -1
          : b.selector === representative.selector
            ? 1
            : stamp(b.updatedAt) - stamp(a.updatedAt),
      )[0];
    const issue = story.querySelector("[data-work-issue]");
    if (issue) {
      issue.hidden = !flagged;
      issue.textContent = flagged
        ? versions.length > 1 && flagged.versionLabel
          ? `${flagged.versionLabel}: ${flagged.issue}`
          : flagged.issue
        : "";
    }
    const extras = story.querySelector("[data-story-extras]");
    const source = repRow?.querySelector("[data-row-extras]");
    if (extras && source && story.dataset.rep !== representative.selector) {
      extras.replaceChildren(...[...source.childNodes].map((node) => node.cloneNode(true)));
    }
    story.dataset.rep = representative.selector;
    return representative;
  }

  // --- "Needs you": at most three cards, derived from live version data.
  const day = 86400000;
  function needsYou(stories, options = {}) {
    const now = options.now ?? new Date();
    const today = Date.parse(now.toISOString().slice(0, 10));
    const reviews = [];
    const retries = [];
    const sources = [];
    const expiry = (version) => {
      if (!version.news) return { expired: false, left: Number.NaN };
      const through = version.validThrough
        ? Date.parse(`${version.validThrough}T00:00:00Z`)
        : Number.NaN;
      return {
        expired: version.sourcesExpired || (Number.isFinite(through) && today > through),
        left: Number.isFinite(through) ? Math.round((through - today) / day) : Number.NaN,
      };
    };
    for (const story of stories) {
      const versions = chronological(story.versions).reverse();
      const latest = versions[0];
      if (!latest) continue;
      const labelOf = (version) =>
        versions.length > 1 && version.versionLabel ? `${version.versionLabel} · ` : "";
      // Sources that need rechecking come first: they block approval and publishing.
      const latestExpiry = expiry(latest);
      if (
        latest.stage !== "published" &&
        (latestExpiry.expired || (latestExpiry.left >= 0 && latestExpiry.left <= 3))
      ) {
        const left = latestExpiry.left;
        sources.push({
          kind: "sources",
          story: story.id,
          selector: latest.selector,
          title: `Recheck sources for “${story.title}”`,
          detail: latestExpiry.expired
            ? "The source review window has ended. Re-read the official sources before sharing."
            : `Source review ends ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`} (${latest.validThrough}).`,
          soon: latestExpiry.expired ? Number.POSITIVE_INFINITY : left,
          since: stamp(latest.updatedAt),
          action: {
            label: "Open to recheck",
            href: `episodes/${encodeURIComponent(latest.selector)}/edit.html`,
          },
        });
        continue;
      }
      const waiting = versions.find((version) => version.stage === "review");
      const superseded =
        waiting &&
        versions.some(
          (version) =>
            ["publish", "published"].includes(version.stage) &&
            stamp(version.updatedAt) > stamp(waiting.updatedAt),
        );
      if (waiting && !superseded && !expiry(waiting).expired)
        reviews.push({
          kind: "review",
          story: story.id,
          selector: waiting.selector,
          title: `Review “${story.title}”`,
          detail: `${labelOf(waiting)}Video is ready · waiting since ${waiting.updatedAt.slice(0, 10)}`,
          since: stamp(waiting.updatedAt),
          action: { label: "Review video", href: waiting.actionHref },
        });
      if (
        ["editing", "review", "publish"].includes(latest.stage) &&
        latest.productionStage &&
        latest.productionStage !== "READY"
      )
        retries.push({
          kind: "retry",
          story: story.id,
          selector: latest.selector,
          title: `Retry “${story.title}”`,
          detail: `${labelOf(latest)}${latest.issue || latest.label || "Production stopped before an MP4 was saved."}`,
          since: stamp(latest.updatedAt),
          action: {
            label:
              latest.stage === "editing" &&
              latest.productionStage === "BLOCKED" &&
              latest.label !== "Ready to retry"
                ? "Fix saved version"
                : "Open to retry",
            href: `episodes/${encodeURIComponent(latest.selector)}/edit.html`,
          },
        });
    }
    reviews.sort((a, b) => a.since - b.since);
    retries.sort((a, b) => b.since - a.since);
    sources.sort((a, b) => a.soon - b.soon || b.since - a.since);
    const groups = [reviews, retries, sources];
    if (options.ideas > 0)
      groups.push([
        {
          kind: "ideas",
          title: `${options.ideas} official SAP ${options.ideas === 1 ? "story" : "stories"} without a short`,
          detail: "Ranked for short-video fit on the Ideas page.",
          action: { label: "See ideas", href: "#ideas" },
        },
      ]);
    // One card per kind first so retries and source warnings are not crowded out by reviews.
    // A story appears at most once.
    const limit = options.limit ?? 3;
    const picked = [];
    const used = new Set();
    for (
      let depth = 0;
      picked.length < limit && groups.some((group) => group.length > depth);
      depth++
    )
      groups.forEach((group, kind) => {
        const card = group[depth];
        if (!card || picked.length >= limit || (card.story && used.has(card.story))) return;
        if (card.story) used.add(card.story);
        picked.push({ kind, depth, card });
      });
    return picked.sort((a, b) => a.kind - b.kind || a.depth - b.depth).map((item) => item.card);
  }

  const icons = {
    review:
      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    retry:
      '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    sources: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ideas:
      '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  };
  function renderNeedsYou(section, cards) {
    const list = section?.querySelector("[data-needs-list]");
    if (!list) return;
    const signature = JSON.stringify(cards);
    if (section.dataset.signature === signature) return;
    section.dataset.signature = signature;
    section.hidden = cards.length === 0;
    list.replaceChildren(
      ...cards.map((card) => {
        const item = document.createElement("article");
        item.className = `attn-card attn-${card.kind}`;
        const icon = document.createElement("span");
        icon.className = "attn-icon";
        icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[card.kind]}</svg>`;
        const body = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = card.title;
        const detail = document.createElement("p");
        detail.textContent = card.detail;
        const action = document.createElement("a");
        action.className = "attn-action";
        action.href = card.action.href;
        action.textContent = card.action.label;
        body.append(title, detail, action);
        item.append(icon, body);
        return item;
      }),
    );
  }

  globalThis.shortsStories = {
    order,
    rank,
    chronological,
    versionLabels,
    pickRepresentative,
    activeVersions,
    workAction,
    readVersion,
    applyWorkflowState,
    renderVersionRow,
    syncStory,
    needsYou,
    renderNeedsYou,
  };
})();
