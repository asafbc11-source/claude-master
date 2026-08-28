/*!
 * AskEngine — a local question-answering engine.
 * ---------------------------------------------------------------------------
 * Give it documents, ask it questions, get answers. Everything happens in the
 * browser: no server, no API key, no network, no third party. Works offline
 * and costs nothing to run.
 *
 * It is a retrieval engine, not a language model. It does not invent text — it
 * understands what a question is asking for, finds the passage that answers it,
 * and hands it back with a confidence signal. When the question falls outside
 * the material it says so instead of guessing.
 *
 * Quick start
 * -----------
 *   const engine = AskEngine.create({
 *     lang: "he",
 *     docs: [
 *       { id: "1", title: "מה זה טוקן", text: "יחידת הטקסט…", tags: ["term"] },
 *       { id: "2", title: "התקנה", text: "פתחו טרמינל…",   tags: ["howto"] }
 *     ]
 *   });
 *
 *   const res = engine.ask("איך מתקינים?");
 *   // → { ok: true, intent: "howto", confidence: "high",
 *   //     answer: { lead, doc, related }, ... }
 *
 * Version 1.0.0 · no dependencies · MIT
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AskEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* =====================================================================
     LANGUAGE PACKS
     A pack decides how a word is folded into a comparable form and which
     words carry no meaning. Add your own with AskEngine.addLanguage().
     ===================================================================== */

  var LANGS = {};

  /* Hebrew is the interesting case. The same word appears in several shapes:
     five letters change form at the end of a word, and the one-letter prefixes
     ו/ה/ב/ל/מ/ש/כ attach straight onto the stem, so "בהקשר" and "הקשר" look
     unrelated to a naive matcher.

     Stripping the prefix outright is wrong — it also eats the first letter of
     words that merely begin with one of those letters ("מכשירים" → "כשירים").
     So a word yields BOTH forms, its own and the stripped one, and a match on
     either counts. "הקשר" gives [הקשר, קשר]; "בהקשר" gives [בהקשר, הקשר];
     they meet on "הקשר", while "מכשירים" keeps itself intact. */
  LANGS.he = {
    normalize: function (w) {
      return w.replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ")
              .replace(/ף/g, "פ").replace(/ץ/g, "צ");
    },
    variants: function (w) {
      var base = this.normalize(w), out = [base];
      if (base.length > 3 && /^[והבלמשכ]/.test(base))   out.push(base.slice(1));
      if (base.length > 5 && /^[וש][הבלמכ]/.test(base)) out.push(base.slice(2));
      return out;
    },
    /* Question words are deliberately here. They reveal the *intent*, which is
       read separately, and leaving them in the search terms only drags long
       chatty passages to the top, because they appear everywhere. */
    stopwords: ["את","של","על","עם","זה","זו","הוא","היא","אני","אתה","הם","הן","יש","אין",
      "לא","כן","אם","או","גם","רק","כל","כדי","יותר","פחות","אבל","כי","אז","הכי","מאוד",
      "עוד","כמו","בין","אחרי","לפני","תוך","בלי","וגם","שלי","שלך","שלו","להם","לי","לו",
      "אשר","כאשר","אותו","אותה","להיות","בו","בה",
      "מה","מהו","מהי","איך","כיצד","למה","מדוע","האם","תן","תסביר","הסבר","רוצה","צריך","אפשר"]
  };

  LANGS.en = {
    normalize: function (w) { return w; },
    variants: function (w) {
      var base = w, out = [base];
      /* fold the endings that turn one word into three */
      if (/ies$/.test(base) && base.length > 4)      out.push(base.slice(0, -3) + "y");
      else if (/(ses|xes|zes|ches|shes)$/.test(base)) out.push(base.slice(0, -2));
      else if (/s$/.test(base) && !/ss$/.test(base) && base.length > 3) out.push(base.slice(0, -1));
      if (/ing$/.test(base) && base.length > 5) out.push(base.slice(0, -3));
      if (/ed$/.test(base)  && base.length > 4) out.push(base.slice(0, -2));
      return out;
    },
    stopwords: ["the","and","for","you","this","that","with","are","was","were","have","has",
      "had","not","but","can","will","from","into","its","it's","they","them","their","there",
      "what","how","why","when","where","which","who","does","did","been","being","your","our",
      "a","an","of","to","in","on","at","by","is","be","as","or","if","do","we","he","she","it"]
  };

  /* Mixed-language content (Hebrew prose with English product names) is the
     common case, so the default routes each word to the pack that fits it. */
  LANGS.auto = {
    pick: function (w) { return /[֐-׿]/.test(w) ? LANGS.he : LANGS.en; },
    normalize: function (w) { return this.pick(w).normalize(w); },
    variants:  function (w) { return this.pick(w).variants(w); },
    stopwords: LANGS.he.stopwords.concat(LANGS.en.stopwords)
  };

  /* =====================================================================
     DEFAULT INTENTS
     An intent says what KIND of answer a question wants. "How do I…" wants
     the setup card, not a paragraph that happens to mention installing.
     Each entry: { name, match (RegExp), prefer {tag: weight}, only [tags] }
     ===================================================================== */

  var DEFAULT_INTENTS = [
    { name: "quiz",    match: /בחן|תבחן|שאלות|מבחן|תרגל|quiz|test me/i,
      prefer: { quiz: 2.0 }, only: ["quiz"] },
    { name: "fix",     match: /תקוע|לא עובד|שגיא|בעיה|נכשל|תקלה|נתקע|קרס|error|broken|fails|stuck/i,
      prefer: { fix: 2.0, warn: 1.3, howto: 1.2 } },
    { name: "explain", match: /איך (זה )?(עובד|פועל|בנוי)|כיצד (זה )?עובד|מה קורה כש|how does .* work|why does/i,
      prefer: { key: 1.4, how: 1.35, term: 1.2 } },
    { name: "howto",   match: /^איך|כיצד|להתקין|התקנה|להפעיל|שלבים|צעדים|מדריך|how (do|to)|steps|setup|install/i,
      prefer: { howto: 1.7, table: 1.15 } },
    { name: "example", match: /דוגמ|למשל|example|for instance/i,
      prefer: { example: 1.7, try: 1.2 } },
    { name: "define",  match: /מה זה|מהו|מהי|פירוש|משמעות|מונח|הגדרה|what is|what are|meaning of/i,
      prefer: { term: 1.5 } },
    { name: "search",  match: /.*/, prefer: {} }
  ];

  /* ===================================================================== */

  function Engine(opts) {
    opts = opts || {};
    this.lang = typeof opts.lang === "string"
      ? (LANGS[opts.lang] || LANGS.auto)
      : (opts.lang || LANGS.auto);

    this.stop = {};
    (this.lang.stopwords || []).concat(opts.stopwords || [])
      .forEach(function (w) { this.stop[w] = 1; }, this);

    this.intents = opts.intents || DEFAULT_INTENTS;
    this.synonyms = opts.synonyms || [];
    this._rootMap = null;

    /* Tuning. Thresholds are RELATIVE (0–1), not raw scores: a raw score
       depends on how many documents you loaded, so a fixed cut-off tuned on a
       thousand pages silently rejects everything in a corpus of ten. */
    this.k1        = opts.k1        !== undefined ? opts.k1        : 1.2;
    this.b         = opts.b         !== undefined ? opts.b         : 0.75;
    this.floor     = opts.floor     !== undefined ? opts.floor     : 0.30;
    this.minCover  = opts.minCover  !== undefined ? opts.minCover  : 0.55;
    this.unsureAt  = opts.unsureAt  !== undefined ? opts.unsureAt  : 0.60;
    this.titleBoost= opts.titleBoost!== undefined ? opts.titleBoost: 0.9;
    this.related   = opts.related   !== undefined ? opts.related   : 3;
    this.labels    = opts.labels    || {};

    this.docs = [];
    this.idf = null;
    this.avgLen = 0;
    this._dirty = true;
    if (opts.docs) this.add(opts.docs);
  }

  /* --- tokenising -------------------------------------------------------- */

  /* A domain lexicon bridges what letters cannot: in Hebrew a verb and its
     noun share a root but not a spelling — someone asks "איך מתקינים" while
     the guide is titled "התקנת". Every member of a synonym group also emits
     the group's first form, and that is where question and answer meet. */
  Engine.prototype._root = function (w) {
    if (!this._rootMap) {
      this._rootMap = {};
      var self = this;
      this.synonyms.forEach(function (group) {
        group.forEach(function (form) { self._rootMap[form] = group[0]; });
      });
    }
    return this._rootMap[w];
  };

  /**
   * Split text into words, each with all the forms it may be written in.
   * Returned grouped, because "is this word known?" is a question about the
   * word, not about each of its spellings — counting variants separately
   * would mark a word two-thirds unknown just for having three forms.
   * @returns {Array<{word:string, forms:string[]}>}
   */
  Engine.prototype.terms = function (s) {
    var out = [], self = this;
    String(s || "").toLowerCase()
      .replace(/[^֐-׿a-z0-9\s]/g, " ")
      .split(/\s+/)
      .forEach(function (w) {
        if (w.length < 2 || self.stop[w]) return;
        var vs = self.lang.variants(w);
        vs.slice().forEach(function (v) {
          var r = self._root(v);
          if (r && vs.indexOf(r) < 0) vs.push(r);
        });
        out.push({ word: w, forms: vs });
      });
    return out;
  };

  /** Flat list of every searchable form in a string. */
  Engine.prototype.tokens = function (s) {
    var out = [];
    this.terms(s).forEach(function (t) { t.forms.forEach(function (f) { out.push(f); }); });
    return out;
  };

  /* --- indexing ---------------------------------------------------------- */

  /**
   * Add documents. Each doc: { id?, title, text, html?, tags?, url?, meta? }
   * Call as often as you like; the index rebuilds lazily on the next query.
   */
  Engine.prototype.add = function (docs) {
    var self = this;
    (Array.isArray(docs) ? docs : [docs]).forEach(function (d) {
      if (!d || (!d.text && !d.title)) return;
      self.docs.push({
        id:    d.id !== undefined ? d.id : String(self.docs.length),
        title: d.title || "",
        text:  d.text  || "",
        html:  d.html  || null,
        tags:  d.tags  || [],
        url:   d.url   || null,
        meta:  d.meta  || {}
      });
    });
    this._dirty = true;
    return this;
  };

  Engine.prototype.build = function () {
    if (!this._dirty) return this;
    var self = this, df = {}, total = 0;

    this.docs.forEach(function (d) {
      d.tok = self.tokens(d.title + " " + d.text);
      d.titleTok = self.tokens(d.title);
      d.bag = {};
      d.tok.forEach(function (t) { d.bag[t] = (d.bag[t] || 0) + 1; });
      d.len = d.tok.length;
      total += d.len;
      var seen = {};
      d.tok.forEach(function (t) { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
    });

    var N = this.docs.length || 1;
    this.idf = {};
    Object.keys(df).forEach(function (t) { self.idf[t] = Math.log(1 + N / df[t]); });
    this.avgLen = total / N;
    this._dirty = false;
    return this;
  };

  /* --- intent ------------------------------------------------------------ */

  Engine.prototype.intentOf = function (q) {
    for (var i = 0; i < this.intents.length; i++) {
      if (this.intents[i].match.test(q)) return this.intents[i];
    }
    return this.intents[this.intents.length - 1];
  };

  /* --- scoring (BM25) ----------------------------------------------------
     Plain term-frequency lets a long rambling passage outscore a short exact
     one just by repeating a word. BM25 fixes both halves: term frequency
     saturates (k1) and a document is penalised for running longer than
     average (b). That is what lets a one-line definition beat a page of
     prose for "what is X".
     ---------------------------------------------------------------------- */

  Engine.prototype.score = function (qt, d, intent, boost) {
    var norm = this.k1 * (1 - this.b + this.b * (d.len / (this.avgLen || 1)));
    var s = 0, done = {}, self = this;

    qt.forEach(function (t) {
      if (done[t]) return;
      done[t] = 1;
      var tf = d.bag[t] || 0;
      if (!tf) {                                  /* prefix match catches inflections we missed */
        for (var k in d.bag) {
          if (k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)) { tf = d.bag[k] * 0.4; break; }
        }
      }
      if (tf) s += (self.idf[t] || 1) * (tf * (self.k1 + 1)) / (tf + norm);
    });
    if (!s) return 0;

    /* Breadth of coverage: a passage that touches every word of the question
       is answering it; one that matches a single common verb probably is not.
       Kept as a gentle multiplier, so a strong partial match still surfaces. */
    var asked = 0, met = 0, seen = {};
    qt.forEach(function (t) {
      if (seen[t]) return;
      seen[t] = 1;
      if ((self.idf[t] || 0) < 0.4) return;
      asked++;
      if (d.bag[t]) { met++; return; }
      for (var k in d.bag) {
        if (k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)) { met++; break; }
      }
    });
    if (asked) s *= 0.65 + 0.35 * (met / asked);

    /* A hit in the title counts for much more — but only for a word that
       actually identifies the subject, or a heading like "how do you create
       it?" wins every "how do you create X" question, whatever X is. */
    var titleHits = 0, seenT = {};
    qt.forEach(function (t) {
      if (seenT[t] || (self.idf[t] || 0) < 1.0) return;
      seenT[t] = 1;
      if (d.titleTok.indexOf(t) >= 0) titleHits++;
    });
    if (titleHits) s *= (1 + self.titleBoost * titleHits);

    /* the intent's preferred tags */
    if (intent && intent.prefer) {
      d.tags.forEach(function (tag) { if (intent.prefer[tag]) s *= intent.prefer[tag]; });
    }
    /* caller-supplied context, e.g. "prefer the page the reader is on" */
    if (boost) s *= boost(d) || 1;
    return s;
  };

  /* --- vocabulary gate ---------------------------------------------------
     Score alone cannot tell an off-topic question apart: a stray word that
     happens to appear in the corpus can outscore a real question. The honest
     signal is vocabulary — do the words of the question exist here at all?
     ---------------------------------------------------------------------- */

  Engine.prototype.coverage = function (q) {
    this.build();
    var groups = typeof q === "string" ? this.terms(q) : q;
    var known = 0, total = 0, self = this;
    groups.forEach(function (g) {
      total++;
      for (var i = 0; i < g.forms.length; i++) {
        var f = g.forms[i];
        if (self.idf[f] !== undefined) { known++; return; }
      }
      for (var k in self.idf) {                    /* a near miss still counts as known */
        for (var j = 0; j < g.forms.length; j++) {
          var v = g.forms[j];
          if (k.length > 3 && v.length > 3 && (k.indexOf(v) === 0 || v.indexOf(k) === 0)) { known++; return; }
        }
      }
    });
    return total ? known / total : 1;
  };

  /* --- public API -------------------------------------------------------- */

  /**
   * Rank documents against a query.
   * @param {string} q
   * @param {object} [opts] { limit, tags, intent, boost }
   * @returns {Array<{doc, score}>}
   */
  Engine.prototype.search = function (q, opts) {
    opts = opts || {};
    this.build();
    var qt = this.tokens(q);
    if (!qt.length) return [];
    var intent = opts.intent || this.intentOf(q);
    var tags = opts.tags || (intent && intent.only);
    var self = this;
    return this.docs
      .filter(function (d) {
        return !tags || d.tags.some(function (t) { return tags.indexOf(t) >= 0; });
      })
      .map(function (d) {
        var s = self.score(qt, d, intent, opts.boost);
        return { doc: d, score: s, relevance: s / self._ideal(qt) };
      })
      .filter(function (r) { return r.relevance > 0.06; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, opts.limit || 5);
  };

  /* The score a perfect hit would earn for this query: every term present,
     once, in a document of average length. Dividing by it turns the raw BM25
     number into a 0–1 relevance that means the same thing in any corpus. */
  Engine.prototype._ideal = function (qt) {
    var sum = 0, seen = {}, self = this;
    qt.forEach(function (t) {
      if (seen[t]) return;
      seen[t] = 1;
      sum += (self.idf[t] || 0);
    });
    if (!sum) sum = 1;
    return sum * (this.k1 + 1) / (1 + this.k1);
  };

  /**
   * Answer a question.
   * @param {string} q
   * @param {object} [opts] { boost, related }
   * @returns {{ok, reason?, intent?, confidence?, score?, answer?}}
   *   answer = { lead, doc, related: [docs] }
   */
  Engine.prototype.ask = function (q, opts) {
    opts = opts || {};
    this.build();

    var resolved = this._resolve(q);
    var query = resolved.text;

    var groups = this.terms(query);
    if (!groups.length) return { ok: false, reason: "empty" };

    /* A follow-up carries the previous subject, which already passed this gate.
       Its own words ("and what about that one?") are mostly unknown by nature,
       so re-testing the merged text would reject a question we understand. */
    var cover = this.coverage(groups);
    if (!resolved.carried && cover < this.minCover) {
      return { ok: false, reason: "out-of-scope", coverage: cover };
    }

    var intent = this.intentOf(q);
    var want = Math.max((opts.related || this.related) + 1, 4);
    var hits = this.search(query, { intent: intent, limit: want, boost: opts.boost });
    if (!hits.length) hits = this.search(query, { intent: intent, tags: null, limit: want, boost: opts.boost });
    if (!hits.length || hits[0].relevance < this.floor) {
      return { ok: false, reason: "no-match", coverage: cover,
               best: hits.length ? hits[0].relevance : 0 };
    }

    /* remember the subject, so the next short question is understood */
    this._lastQuery = query;
    this._lastTerms = groups;

    var unsure = hits[0].relevance < this.unsureAt;
    var composed = this.compose(query, hits, intent.name);

    return {
      ok: true,
      intent: intent.name,
      confidence: unsure ? "low" : "high",
      score: hits[0].score,
      relevance: hits[0].relevance,
      coverage: cover,
      carriedContext: resolved.carried,
      answer: {
        lead: unsure
          ? (this.labels.unsure || "This is the closest match I found:")
          : (this.labels[intent.name] || this.labels.search || "Here is what I found:"),
        doc: hits[0].doc,
        related: hits.slice(1).map(function (h) { return h.doc; }),
        sections: composed.sections,
        text: composed.text
      },
      sources: hits.map(function (h) { return h.doc; })
    };
  };

  /**
   * Retrieval-augmented generation.
   *
   * The engine finds the passages that matter and hands them to a generator
   * you supply, which writes the actual answer. That generator is the only
   * part that needs a model — everything else stays local. Pass any function
   * of the shape `({question, context, sources}) => Promise<string>`: an
   * Anthropic call, another provider, a model running on device, anything.
   *
   *   const res = await engine.generate("compare A and B", {
   *     generator: async ({question, context}) => callYourModel(question, context)
   *   });
   *
   * Without a generator it falls back to ask(), so the same code path works
   * whether or not a model is available.
   */
  Engine.prototype.generate = function (q, opts) {
    opts = opts || {};
    var gen = opts.generator || this.generator;
    var base = this.ask(q, opts);
    if (!gen) return Promise.resolve(assign({}, base, { generated: false }));
    if (!base.ok && base.reason === "out-of-scope" && !opts.answerAnything) {
      return Promise.resolve(assign({}, base, { generated: false }));
    }

    var hits = base.ok ? base.sources : this.search(q, { limit: opts.contextDocs || 5 }).map(function (h) { return h.doc; });
    var budget = opts.contextChars || 6000;
    var context = "", used = [];
    for (var i = 0; i < hits.length && context.length < budget; i++) {
      var d = hits[i];
      var chunk = "### " + d.title + "\n" + d.text + "\n\n";
      if (context.length + chunk.length > budget) chunk = chunk.slice(0, budget - context.length);
      context += chunk;
      used.push(d);
    }

    return Promise.resolve(gen({ question: q, context: context, sources: used, intent: base.intent }))
      .then(function (text) {
        return assign({}, base, { ok: true, generated: true, text: text, sources: used });
      })
      .catch(function (err) {
        return assign({}, base, { generated: false, generatorError: String(err && err.message || err) });
      });
  };

  /* =====================================================================
     COMPOSING AN ANSWER
     Returning a whole passage is blunt: most of it is not what was asked.
     The composer scores the passage sentence by sentence, keeps the lines
     that carry the answer, and assembles them into sections shaped by the
     intent — a definition reads differently from a set of steps.
     It never invents a sentence. Every line comes from the material.
     ===================================================================== */

  /** Split prose into sentences. Hebrew and English share the punctuation. */
  Engine.prototype.sentences = function (text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?:;])\s+|(?:\s+[·•]\s+)/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 15; });
  };

  /** The sentences of a text that best answer this query, in original order. */
  Engine.prototype.keySentences = function (text, qt, limit) {
    var sents = this.sentences(text);
    if (sents.length <= 1) return sents;
    var self = this;
    var scored = sents.map(function (s, i) {
      var bag = {};
      self.tokens(s).forEach(function (t) { bag[t] = (bag[t] || 0) + 1; });
      var sc = 0, seen = {};
      qt.forEach(function (t) {
        if (seen[t]) return;
        seen[t] = 1;
        if (bag[t]) sc += (self.idf[t] || 1);
        else for (var k in bag) {
          if (k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)) { sc += (self.idf[t] || 1) * 0.4; break; }
        }
      });
      /* an opening sentence usually states the thing itself */
      if (i === 0) sc += 0.8;
      return { s: s, i: i, sc: sc };
    });
    var keep = scored.slice().sort(function (a, b) { return b.sc - a.sc; })
                     .slice(0, limit || 3).filter(function (r) { return r.sc > 0; });
    if (!keep.length) keep = scored.slice(0, 1);
    return keep.sort(function (a, b) { return a.i - b.i; }).map(function (r) { return r.s; });
  };

  /** Pull an ordered list out of a document's html, when it has one. */
  function listFrom(html) {
    if (!html || typeof document === "undefined") return null;
    var d = document.createElement("div");
    d.innerHTML = html;
    var li = d.querySelectorAll("li");
    if (li.length < 2) return null;
    return Array.prototype.map.call(li, function (n) {
      return n.textContent.replace(/\s+/g, " ").trim();
    }).filter(function (t) { return t.length > 2; });
  }

  /**
   * Build a structured answer from the ranked hits.
   * @returns {{sections: Array, text: string}}
   *   section = { type: "lead"|"steps"|"points"|"quote"|"note", title?, items?, text? }
   */
  Engine.prototype.compose = function (q, hits, intent) {
    var qt = this.tokens(q), self = this, sections = [], used = {};
    var top = hits[0].doc;

    /* how-to and fix questions want the steps, if the source has them */
    if (intent === "howto" || intent === "fix") {
      var steps = listFrom(top.html);
      if (steps && steps.length) {
        sections.push({ type: "steps", title: top.title, items: steps.slice(0, 8), doc: top });
        used[top.id] = 1;
      }
    }

    /* the core of the answer: the lines that actually address the question */
    if (!used[top.id]) {
      var lines = this.keySentences(top.text, qt, intent === "define" ? 2 : 3);
      sections.push({ type: "lead", title: top.title, text: lines.join(" "), doc: top });
      used[top.id] = 1;
    }

    /* other passages that add something the first one did not say */
    var extra = [];
    hits.slice(1).forEach(function (h) {
      if (used[h.doc.id] || extra.length >= 3) return;
      var line = self.keySentences(h.doc.text, qt, 1)[0];
      if (!line) return;
      /* skip anything that merely repeats what has been said */
      var already = sections.map(function (s) { return s.text || (s.items || []).join(" "); }).join(" ");
      var lineTok = self.tokens(line), overlapTok = self.tokens(already), same = 0;
      lineTok.forEach(function (t) { if (overlapTok.indexOf(t) >= 0) same++; });
      if (lineTok.length && same / lineTok.length > 0.8) return;
      extra.push({ text: line, doc: h.doc });
    });
    if (extra.length) sections.push({ type: "points", title: null, items: extra });

    var text = sections.map(function (s) {
      if (s.type === "steps") return s.items.map(function (t, i) { return (i + 1) + ". " + t; }).join("\n");
      if (s.type === "points") return s.items.map(function (p) { return "• " + p.text; }).join("\n");
      return s.text;
    }).join("\n\n");

    return { sections: sections, text: text };
  };

  /* =====================================================================
     FOLLOW-UP QUESTIONS
     "And what about the second one?" carries almost no words of its own.
     The engine keeps the terms of the last real question and merges them in,
     so a short follow-up is understood in the context it was asked.
     ===================================================================== */

  Engine.prototype._resolve = function (q) {
    var groups = this.terms(q);
    var contentful = groups.filter(function (g) { return g.word.length > 2; });
    var isFollowUp = contentful.length <= 2 &&
      /^(ומה|ואיך|ולמה|ואם|ובאיזה|וזה|אז מה|ומתי|and |what about|and how)/i.test(q.trim());
    if (isFollowUp && this._lastTerms && this._lastTerms.length) {
      return { text: q + " " + this._lastQuery, carried: true };
    }
    return { text: q, carried: false };
  };

  /** Index size and vocabulary, useful when tuning. */
  Engine.prototype.stats = function () {
    this.build();
    return { docs: this.docs.length, terms: Object.keys(this.idf).length, avgLength: Math.round(this.avgLen) };
  };

  /* =====================================================================
     HELPERS
     ===================================================================== */

  /**
   * Turn an HTML string (or element) into documents, splitting at headings so
   * each section is retrievable on its own. Requires a DOM.
   * @param {string|Element} html
   * @param {object} [opts] { splitOn, tagMap, base, minLength }
   * @returns {Array} docs ready for add()
   */
  function docsFromHTML(html, opts) {
    opts = opts || {};
    if (typeof document === "undefined") throw new Error("docsFromHTML needs a DOM");
    var splitOn = opts.splitOn || ["H1", "H2", "H3"];
    var tagMap = opts.tagMap || {};
    var minLen = opts.minLength || 60;
    var base = opts.base || {};
    var root;
    if (typeof html === "string") { root = document.createElement("div"); root.innerHTML = html; }
    else root = html;

    var docs = [], head = base.title || "", buf = [], n = 0;
    function flush() {
      var text = buf.join(" ").replace(/\s+/g, " ").trim();
      buf = [];
      if (text.length < minLen) return;
      docs.push(assign({}, base, { id: (base.id || "doc") + ":" + (n++), title: head, text: text, tags: ["passage"] }));
    }
    Array.prototype.forEach.call(root.children, function (el) {
      if (splitOn.indexOf(el.tagName) >= 0) { flush(); head = el.textContent.trim(); return; }
      var tag = null;
      for (var cls in tagMap) { if (el.classList && el.classList.contains(cls)) { tag = tagMap[cls]; break; } }
      if (tag) {
        docs.push(assign({}, base, {
          id: (base.id || "doc") + ":" + (n++), title: head,
          text: el.textContent, html: el.outerHTML, tags: [tag]
        }));
        return;
      }
      buf.push(el.textContent);
    });
    flush();
    return docs;
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  /** Escape text for safe insertion into HTML. */
  function escapeHTML(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");
  }

  /**
   * Render an ask() result as HTML. Entirely optional — ask() returns plain
   * data so any UI can present it however it likes.
   */
  function renderAnswer(res, opts) {
    opts = opts || {};
    var cls = opts.classPrefix || "ae";
    if (!res.ok) {
      return '<div class="' + cls + '-miss">' +
        escapeHTML(opts.missText || "I could not find that in the material.") + '</div>';
    }
    /* a generator wrote the answer */
    if (res.generated) {
      return '<div class="' + cls + '-lead">' + escapeHTML(res.answer ? res.answer.lead : "") + '</div>' +
        '<div class="' + cls + '-card">' + escapeHTML(res.text).replace(/\n/g, "<br>") +
        (res.sources && res.sources.length
          ? '<div class="' + cls + '-src">' + res.sources.map(function (d) {
              return d.url ? '<a class="' + cls + '-link" href="' + escapeHTML(d.url) + '">' +
                             escapeHTML(d.title) + '</a>' : escapeHTML(d.title);
            }).join(" · ") + '</div>'
          : "") + '</div>';
    }

    var a = res.answer;
    var link = function (d) {
      return d.url ? '<a class="' + cls + '-link" href="' + escapeHTML(d.url) + '">' + escapeHTML(d.title) + '</a>'
                   : escapeHTML(d.title);
    };
    var html = '<div class="' + cls + '-lead">' + escapeHTML(a.lead) + '</div><div class="' + cls + '-card">';

    if (opts.raw && a.doc.html) {
      html += a.doc.html;
    } else {
      (a.sections || []).forEach(function (s) {
        if (s.type === "steps") {
          html += '<ol class="' + cls + '-steps">' +
            s.items.map(function (t) { return "<li>" + escapeHTML(t) + "</li>"; }).join("") + '</ol>';
        } else if (s.type === "points") {
          html += '<ul class="' + cls + '-points">' + s.items.map(function (p) {
            return "<li>" + escapeHTML(p.text) +
              (p.doc && p.doc.url ? ' <span class="' + cls + '-from">' + link(p.doc) + '</span>' : "") + "</li>";
          }).join("") + '</ul>';
        } else {
          html += "<p>" + escapeHTML(s.text) + "</p>";
        }
      });
    }
    html += '<div class="' + cls + '-src">' + link(a.doc) + '</div></div>';

    if (a.related && a.related.length) {
      html += '<div class="' + cls + '-more">' + a.related.map(function (d) {
        return '<div class="' + cls + '-rel">' + link(d) +
          '<span>' + escapeHTML(d.text.replace(/\s+/g, " ").slice(0, 95)) + '…</span></div>';
      }).join("") + '</div>';
    }
    return html;
  }

  /* =====================================================================
     EXPORT
     ===================================================================== */

  var AskEngine = {
    version: "1.0.0",
    /** Create an engine. See the file header for options. */
    create: function (opts) { return new Engine(opts); },
    /** Register a language pack: { normalize, variants, stopwords }. */
    addLanguage: function (name, pack) { LANGS[name] = pack; return this; },
    languages: LANGS,
    defaultIntents: DEFAULT_INTENTS,
    docsFromHTML: docsFromHTML,
    renderAnswer: renderAnswer,
    escapeHTML: escapeHTML,
    Engine: Engine
  };

  return AskEngine;
});
