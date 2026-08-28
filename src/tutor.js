/* ===================== TUTOR — a local answer engine =====================
   Built from scratch for this app. No server, no API key, no third party,
   no network. It indexes every passage already written in the course,
   works out what a question is asking for, ranks the material against it,
   and composes an answer. Everything runs on the device, offline, forever.
   ------------------------------------------------------------------------ */
const TUTOR = {
  units: null,
  idf: null,

  /* --- Hebrew normalisation ---------------------------------------------
     Hebrew writes the same word many ways: final letters change shape at the
     end of a word, and one-letter prefixes (ו/ה/ב/ל/מ/ש/כ) glue straight onto
     the stem, so "בהקשר" and "הקשר" look unrelated.

     Stripping the prefix outright is wrong: it would also eat the first letter
     of words that merely start with one of those letters ("מכשירים" → "כשירים").
     So a word emits BOTH forms — the word itself and its stripped variant — and
     a match on either counts. "הקשר" gives [הקשר, קשר]; "בהקשר" gives
     [בהקשר, הקשר]; they meet on "הקשר", while "מכשירים" keeps itself intact. */
  norm(w){
    return w.replace(/ך/g,"כ").replace(/ם/g,"מ").replace(/ן/g,"נ")
            .replace(/ף/g,"פ").replace(/ץ/g,"צ");
  },
  /* Hebrew verbs and their nouns share a root but not a spelling: someone asks
     "איך מתקינים" while the guide is titled "התקנת". Letter-level tricks can't
     bridge that, so the app carries a small lexicon of the actions it actually
     teaches. Every member of a group also emits the group's first form, which
     is what makes question and answer meet. */
  SYN: [
    ["התקנ","התקנה","התקנת","מתקינ","מתקינימ","להתקינ","מותקנ","התקינ","מתקינה"],
    ["יציר","יצירה","יצירת","יוצר","יוצרימ","ליצור","נוצר","בונ","לבנות","בונימ","בנייה","בניית"],
    ["חיבור","לחבר","מחבר","מחברימ","מחובר","מחוברת","לחברמ"],
    ["שמיר","לשמור","שומר","שמירה","נשמר","שומרימ"],
    ["הפעל","להפעיל","מפעיל","הפעלה","מופעל","מפעילימ"],
    ["פרסומ","לפרסמ","מפרסמ","פרסמ","מפורסמ"],
    ["תכנונ","לתכננ","מתכננ","תכננ","תוכנית","תכנית","תכנונ"],
    ["סנכרונ","לסנכרנ","מסנכרנ","סנכרנ","מסונכרנ"],
    ["בדיק","לבדוק","בודק","בדיקה","נבדק","בודקימ"],
    ["מחיק","למחוק","מוחק","מחיקה","נמחק"],
    ["עריכ","לערוכ","עורכ","עריכה","נערכ"],
    ["שיתופ","לשתפ","משתפ","שיתופ","משותפ"]
  ],
  root(w){
    if(!this._rootMap){
      this._rootMap = {};
      this.SYN.forEach(g => g.forEach(f => this._rootMap[f] = g[0]));
    }
    return this._rootMap[w];
  },
  variants(w){
    const base = this.norm(w);
    const out = [base];
    if(base.length > 3 && /^[והבלמשכ]/.test(base))   out.push(base.slice(1));
    if(base.length > 5 && /^[וש][הבלמכ]/.test(base)) out.push(base.slice(2));
    out.slice().forEach(v => { const r = this.root(v); if(r && out.indexOf(r) < 0) out.push(r); });
    return out;
  },
  /* Question words are deliberately here: they tell us the *intent*, and
     intent() already reads them. Leaving them in the search terms only drags
     long chatty passages to the top, because they appear everywhere. */
  STOP: new Set(["את","של","על","עם","זה","זו","הוא","היא","אני","אתה","הם","הן","יש","אין",
    "לא","כן","אם","או","גם","רק","כל","כדי","יותר","פחות","אבל","כי","אז","הכי","מאוד","עוד",
    "כמו","בין","אחרי","לפני","תוך","בלי","האם","וגם","שלי","שלך","שלו","להם","לי","לו","אשר",
    "כאשר","אותו","אותה","להיות","בו","בה",
    "מה","מהו","מהי","איך","כיצד","למה","מדוע","האם","תן","תסביר","הסבר","רוצה","צריך","אפשר",
    "the","and","for","you","this","that","with","what","how","why","does","can"]),

  tokens(s){
    const out = [];
    (s || "").toLowerCase()
      .replace(/[^֐-׿a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1 && !this.STOP.has(w))
      .forEach(w => this.variants(w).forEach(v => out.push(v)));
    return out;
  },

  /* --- index -------------------------------------------------------------
     Every lesson is split at its headings, and each box, how-to card and
     prompt example becomes its own retrievable unit with a type tag. */
  build(){
    if(this.units) return this.units;
    const U = [], tmp = document.createElement("div");
    const push = o => { o.tok = this.tokens(o.title + " " + o.text); U.push(o); };

    MODS.forEach(m => {
      m.lessons.forEach(l => {
        tmp.innerHTML = l.html;
        const at = {mid:m.id, lid:l.id, mod:m.title, lesson:l.title, url:"#l/"+m.id+"/"+l.id};
        let head = l.title, buf = [];
        const flush = () => {
          const text = buf.join(" ").replace(/\s+/g," ").trim();
          if(text.length > 60) push(Object.assign({kind:"passage", title:head, text:text, html:null}, at));
          buf = [];
        };
        [...tmp.children].forEach(el => {
          if(el.tagName === "H2"){ flush(); head = el.textContent.trim(); return; }
          if(el.classList.contains("howto")){
            const b = el.querySelector("b");
            push(Object.assign({kind:"howto", title:b?b.textContent:"מדריך הפעלה",
              text:el.textContent, html:el.outerHTML}, at));
            const fix = el.querySelector(".ht-fix");
            if(fix) push(Object.assign({kind:"fix", title:"פתרון תקלות · "+l.title,
              text:fix.textContent, html:fix.outerHTML}, at));
            const how = el.querySelector(".box.info");
            if(how) push(Object.assign({kind:"how", title:"איך זה עובד · "+l.title,
              text:how.textContent, html:how.outerHTML}, at));
            return;
          }
          if(el.classList.contains("box")){
            const kind = el.classList.contains("pro")  ? "key"
                       : el.classList.contains("warn") ? "warn"
                       : el.classList.contains("try")  ? "try" : "note";
            push(Object.assign({kind:kind, title:head, text:el.textContent, html:el.outerHTML}, at));
            return;
          }
          if(el.classList.contains("prompt-ex")){
            push(Object.assign({kind:"example", title:head, text:el.textContent, html:el.outerHTML}, at));
            return;
          }
          if(el.classList.contains("tbl-wrap") || el.tagName === "TABLE"){
            push(Object.assign({kind:"table", title:head, text:el.textContent, html:el.outerHTML}, at));
            return;
          }
          buf.push(el.textContent);
        });
        flush();
      });
      m.exercises.forEach(x => push({kind:"exercise", title:x.title,
        text:x.goal+" "+x.steps.join(" "), html:null,
        mid:m.id, lid:null, mod:m.title, lesson:x.title, url:"#x/"+m.id+"/"+x.id}));
      m.quiz.forEach(q => push({kind:"quiz", title:q.q,
        text:q.q+" "+q.opts[q.a]+" "+q.exp, html:null, q:q,
        mid:m.id, lid:null, mod:m.title, lesson:q.q, url:"#m/"+m.id+"/quiz"}));
    });

    GLOSS.forEach(g => push({kind:"term", title:g.he+" · "+g.en,
      text:g.he+" "+g.en+" "+g.def,
      html:'<b style="color:var(--brand)">'+esc(g.he)+'</b> <span class="gen">'+esc(g.en)+'</span><p style="margin-top:4px">'+esc(g.def)+'</p>',
      mid:null, lid:null, mod:"מילון המונחים", lesson:g.he, url:"#gloss"}));

    /* inverse document frequency — a rare word says more than a common one */
    const df = {};
    U.forEach(u => new Set(u.tok).forEach(t => df[t] = (df[t]||0) + 1));
    this.idf = {};
    const N = U.length;
    Object.keys(df).forEach(t => this.idf[t] = Math.log(1 + N/df[t]));
    /* pre-compute the bag of terms and the average length, for BM25 below */
    let total = 0;
    U.forEach(u => {
      const bag = {};
      u.tok.forEach(t => bag[t] = (bag[t]||0) + 1);
      u.bag = bag;
      u.len = u.tok.length;
      total += u.len;
    });
    this.avgLen = total / (U.length || 1);
    this.units = U;
    return U;
  },

  /* --- what is the question asking for? --------------------------------- */
  intent(q){
    const t = q.toLowerCase();
    if(/בחן|תבחן|שאלות|מבחן|תרגל|לתרגל|שאל אותי/.test(t))            return "quiz";
    if(/תקוע|לא עובד|שגיא|בעיה|נכשל|תקלה|נתקע|קרס|לא מצליח/.test(t)) return "fix";
    /* "how does X work" is a request to understand, not a set of steps */
    if(/איך (זה )?(עובד|פועל|בנוי)|כיצד (זה )?עובד|מה קורה כש/.test(t)) return "explain";
    if(/איך|כיצד|להתקין|התקנה|להפעיל|שלבים|צעדים|מדריך/.test(t))     return "howto";
    if(/דוגמ|למשל|תן לי דוג/.test(t))                                 return "example";
    if(/מה זה|מהו|מהי|פירוש|משמעות|מונח|הגדרה/.test(t))              return "term";
    if(/הסבר|פשוט|במילים פשוטות|לא הבנתי|תסביר|למה/.test(t))         return "explain";
    return "search";
  },

  /* --- ranking (BM25) -----------------------------------------------------
     Plain term-frequency lets a long rambling passage outscore a short exact
     one, just by repeating a word. BM25 fixes both halves of that: term
     frequency saturates (k1), and a document is penalised for being longer
     than average (b). That is what makes a one-line glossary entry beat a
     page of prose for "what is X". */
  K1: 1.2,
  B: 0.75,
  /* an intent says which *kind* of passage answers it — a "how do I" question
     wants the setup card, not a paragraph that happens to say "install" */
  PREFER: {howto:{howto:1.7,table:1.15}, fix:{fix:2.0,warn:1.3,howto:1.2},
           term:{term:1.5}, example:{example:1.7,try:1.2}, explain:{key:1.4,how:1.35}},
  score(qt, u, ctxMid, ctxLid, intent){
    const bag = u.bag, norm = this.K1 * (1 - this.B + this.B * (u.len / this.avgLen));
    let s = 0;
    const done = {};
    qt.forEach(t => {
      if(done[t]) return;
      done[t] = 1;
      let tf = bag[t] || 0;
      if(!tf){                       /* prefix match catches inflections we missed */
        for(const k in bag){
          if(k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)){ tf = bag[k] * 0.4; break; }
        }
      }
      if(tf) s += (this.idf[t]||1) * (tf * (this.K1 + 1)) / (tf + norm);
    });
    if(!s) return 0;
    /* Reward breadth of coverage. A passage that touches every word of the
       question is answering it; one that matches a single common verb is
       probably answering a different question. Kept as a gentle multiplier
       rather than a penalty, so a strong partial match still surfaces. */
    const uniq = {};
    let asked = 0, met = 0;
    qt.forEach(t => {
      if(uniq[t]) return;
      uniq[t] = 1;
      if((this.idf[t] || 0) < 0.4) return;   /* ignore words that say nothing */
      asked++;
      if(bag[t]) { met++; return; }
      for(const k in bag){
        if(k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)){ met++; break; }
      }
    });
    if(asked) s *= 0.65 + 0.35 * (met / asked);
    /* A hit in the title is worth far more than one buried in the body — but
       only for a word that actually identifies the subject. Otherwise a
       heading like "how do you create it?" wins every "how do you create X"
       question, whatever X happens to be. */
    const titleTok = u.titleTok || (u.titleTok = this.tokens(u.title));
    let titleHits = 0;
    const seen = {};
    qt.forEach(t => {
      if(seen[t] || (this.idf[t] || 0) < 1.0) return;
      seen[t] = 1;
      if(titleTok.indexOf(t) >= 0) titleHits++;
    });
    if(titleHits) s *= (1 + 0.9 * titleHits);
    const pref = this.PREFER[intent];
    if(pref && pref[u.kind]) s *= pref[u.kind];
    if(ctxLid && u.lid === ctxLid)      s *= 1.5;   /* the lesson being read breaks ties */
    else if(ctxMid && u.mid === ctxMid) s *= 1.2;
    return s;
  },

  find(q, ctxMid, ctxLid, kinds, n, intent){
    const qt = this.tokens(q);
    if(!qt.length) return [];
    return this.build()
      .filter(u => !kinds || kinds.indexOf(u.kind) >= 0)
      .map(u => ({u:u, s:this.score(qt, u, ctxMid, ctxLid, intent)}))
      .filter(r => r.s > 1.5)
      .sort((a,b) => b.s - a.s)
      .slice(0, n || 4);
  },
  /* Knowing when NOT to answer.
     Score alone can't decide it: "מתכון לעוגת שוקולד" scores higher than a real
     question, because "מתכון" happens to appear in the Cowork module. The
     honest signal is vocabulary — do the words of the question exist in this
     course at all? "שוקולד" and "מונדיאל" do not, and that is what gives the
     question away. Coverage decides whether to answer; the score decides how
     confidently to phrase it. */
  FLOOR: 8,
  coverage(qt){
    const seen = {};
    let known = 0, total = 0;
    qt.forEach(t => {
      if(seen[t] || t.length < 2) return;
      seen[t] = 1;
      if(this.STOP.has(t)) return;
      total++;
      if(this.idf[t] !== undefined) known++;
      else {
        for(const k in this.idf){
          if(k.length > 3 && (k.indexOf(t) === 0 || t.indexOf(k) === 0)){ known++; break; }
        }
      }
    });
    return total ? known / total : 0;
  },

  /* --- compose the answer ------------------------------------------------ */
  answer(q){
    const h = (location.hash||"").slice(1).split("/");
    const ctxMid = (h[0]==="l"||h[0]==="x"||h[0]==="m") ? h[1] : null;
    const ctxLid = (h[0]==="l") ? h[2] : null;
    const it = this.intent(q);
    const link = u => '<a class="tut-link" href="'+u.url+'" onclick="closeChat()">'+
                      esc(u.mod)+' › '+esc(u.lesson)+'</a>';

    if(it === "quiz"){
      const m = ctxMid ? modById(ctxMid) : null;
      const pool = m ? m.quiz : MODS.flatMap(x => x.quiz);
      if(pool.length){
        const pick = shuffle(pool).slice(0,3);
        return {ok:true, html:
          '<div class="tut-lead">בוא נבחן אותך'+(m ? " על "+esc(m.title) : "")+':</div>'+
          pick.map((q,i) =>
            '<div class="tut-q"><b>'+(i+1)+'. '+esc(q.q)+'</b>'+
            '<div class="tut-ans">✅ '+esc(q.opts[q.a])+'</div>'+
            '<div class="tut-exp">'+esc(q.exp)+'</div></div>').join("")+
          '<div class="tut-foot">לסבב מלא — לשונית הבוחן במודול.</div>'};
      }
    }

    const kindsFor = {
      fix:     ["fix","warn","howto"],
      howto:   ["howto","passage","key","table"],
      example: ["example","try","passage"],
      term:    ["term","passage","key"],
      explain: ["key","how","passage","note","term"],
      search:  null
    }[it];

    this.build();
    if(this.coverage(this.tokens(q)) < 0.55) return {ok:false};

    let hits = this.find(q, ctxMid, ctxLid, kindsFor, 4, it);
    if(!hits.length) hits = this.find(q, ctxMid, ctxLid, null, 4, it);
    if(!hits.length || hits[0].s < this.FLOOR) return {ok:false};
    const unsure = hits[0].s < 14;

    const lead = {
      fix:     "נראה שזו הבעיה:",
      howto:   "הנה איך עושים את זה:",
      example: "הנה דוגמה מהחומר:",
      term:    "הנה ההגדרה:",
      explain: "הנה ההסבר:",
      search:  "מצאתי את זה בחומר:"
    }[it];

    const top = hits[0].u;
    let html = '<div class="tut-lead">'+(unsure ? "לא בטוח שזה מה שחיפשת, אבל זה הכי קרוב שמצאתי:" : lead)+
      '</div><div class="tut-card">'+
      (top.html ? top.html
                : '<p>'+esc(top.text.slice(0,700))+(top.text.length>700 ? "…" : "")+'</p>')+
      '<div class="tut-src">📍 '+link(top)+'</div></div>';

    const rest = hits.slice(1);
    if(rest.length){
      html += '<div class="tut-more"><b>קשור לזה</b>'+
        rest.map(r => '<div class="tut-rel">'+link(r.u)+
          '<span>'+esc(r.u.text.replace(/\s+/g," ").slice(0,95))+'…</span></div>').join("")+
        '</div>';
    }
    return {ok:true, html:html};
  }
};
