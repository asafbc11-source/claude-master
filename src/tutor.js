/* ===================== TUTOR — the course adapter ========================
   The engine itself lives in tools/ask-engine/ask-engine.js and knows nothing
   about this course. This file is the adapter: it turns the course into
   documents, configures the engine for Hebrew and for the way lessons are
   written, and shapes the result into what the chat panel renders.

   Everything runs on the device — no server, no API key, no network.
   ------------------------------------------------------------------------ */
const TUTOR = {
  engine: null,

  /* Hebrew verbs and their nouns share a root but not a spelling: a learner
     asks "איך מתקינים" while the guide is titled "התקנת". No letter-level rule
     bridges that, so the course carries a lexicon of the actions it teaches. */
  SYNONYMS: [
    ["התקנ","התקנה","התקנת","מתקינ","מתקינימ","להתקינ","מותקנ","התקינ","מתקינה"],
    ["יציר","יצירה","יצירת","יוצר","יוצרימ","ליצור","נוצר","בונ","לבנות","בונימ","בנייה","בניית"],
    ["חיבור","לחבר","מחבר","מחברימ","מחובר","מחוברת"],
    ["שמיר","לשמור","שומר","שמירה","נשמר","שומרימ"],
    ["הפעל","להפעיל","מפעיל","הפעלה","מופעל","מפעילימ"],
    ["פרסומ","לפרסמ","מפרסמ","פרסמ","מפורסמ"],
    ["תכנונ","לתכננ","מתכננ","תכננ","תוכנית","תכנית"],
    ["סנכרונ","לסנכרנ","מסנכרנ","סנכרנ","מסונכרנ"],
    ["בדיק","לבדוק","בודק","בדיקה","נבדק","בודקימ"],
    ["מחיק","למחוק","מוחק","מחיקה","נמחק"],
    ["עריכ","לערוכ","עורכ","עריכה","נערכ"],
    ["שיתופ","לשתפ","משתפ","משותפ"],
    ["ניקוי","לנקות","מנקה","נקי","לניקוי"]
  ],

  LABELS: {
    define:  "הנה ההגדרה:",
    howto:   "הנה איך עושים את זה:",
    fix:     "נראה שזו הבעיה:",
    example: "הנה דוגמה מהחומר:",
    explain: "הנה ההסבר:",
    search:  "מצאתי את זה בחומר:",
    unsure:  "לא בטוח שזה מה שחיפשת, אבל זה הכי קרוב שמצאתי:"
  },

  /* Turn the course into documents. Lessons split at their headings, and each
     box, setup card and prompt example becomes retrievable on its own, tagged
     so an intent can prefer the right sort of passage. */
  docs(){
    const D = [], tmp = document.createElement("div");
    MODS.forEach(m => {
      m.lessons.forEach(l => {
        tmp.innerHTML = l.html;
        const at = { url:"#l/"+m.id+"/"+l.id, meta:{mid:m.id, lid:l.id, mod:m.title, lesson:l.title} };
        let head = l.title, buf = [], n = 0;
        const put = (o) => D.push(Object.assign({id:m.id+"/"+l.id+"/"+(n++)}, at, o));
        const flush = () => {
          const text = buf.join(" ").replace(/\s+/g," ").trim();
          buf = [];
          if(text.length > 60) put({title:head, text:text, tags:["passage"]});
        };
        [...tmp.children].forEach(el => {
          if(el.tagName === "H2"){ flush(); head = el.textContent.trim(); return; }
          if(el.classList.contains("howto")){
            const b = el.querySelector("b");
            put({title:b?b.textContent:"מדריך הפעלה", text:el.textContent, html:el.outerHTML, tags:["howto"]});
            const fix = el.querySelector(".ht-fix");
            if(fix) put({title:"פתרון תקלות · "+l.title, text:fix.textContent, html:fix.outerHTML, tags:["fix"]});
            const how = el.querySelector(".box.info");
            if(how) put({title:"איך זה עובד · "+l.title, text:how.textContent, html:how.outerHTML, tags:["how"]});
            return;
          }
          if(el.classList.contains("box")){
            const tag = el.classList.contains("pro")  ? "key"
                      : el.classList.contains("warn") ? "warn"
                      : el.classList.contains("try")  ? "try" : "note";
            put({title:head, text:el.textContent, html:el.outerHTML, tags:[tag]});
            return;
          }
          if(el.classList.contains("prompt-ex")){
            put({title:head, text:el.textContent, html:el.outerHTML, tags:["example"]});
            return;
          }
          if(el.classList.contains("tbl-wrap") || el.tagName === "TABLE"){
            put({title:head, text:el.textContent, html:el.outerHTML, tags:["table"]});
            return;
          }
          buf.push(el.textContent);
        });
        flush();
      });
      m.exercises.forEach(x => D.push({id:"x/"+m.id+"/"+x.id, title:x.title,
        text:x.goal+" "+x.steps.join(" "), tags:["exercise"], url:"#x/"+m.id+"/"+x.id,
        meta:{mid:m.id, mod:m.title, lesson:x.title}}));
      m.quiz.forEach(q => D.push({id:"q/"+q.id, title:q.q, text:q.q+" "+q.opts[q.a]+" "+q.exp,
        tags:["quiz"], url:"#m/"+m.id+"/quiz", meta:{mid:m.id, mod:m.title, lesson:q.q, q:q}}));
    });
    GLOSS.forEach(g => D.push({id:"g/"+g.en, title:g.he+" · "+g.en, text:g.he+" "+g.en+" "+g.def,
      html:'<b style="color:var(--brand)">'+esc(g.he)+'</b> <span class="gen">'+esc(g.en)+
           '</span><p style="margin-top:4px">'+esc(g.def)+'</p>',
      tags:["term"], url:"#gloss", meta:{mod:"מילון המונחים", lesson:g.he}}));
    return D;
  },

  build(){
    if(this.engine) return this.engine;
    this.engine = AskEngine.create({
      lang: "he",
      docs: this.docs(),
      synonyms: this.SYNONYMS,
      labels: this.LABELS
    });
    return this.engine;
  },

  /* Where the reader is now breaks ties: the same word means the thing the
     current lesson is about far more often than it means anything else. */
  context(){
    const h = (location.hash||"").slice(1).split("/");
    return { mid: (h[0]==="l"||h[0]==="x"||h[0]==="m") ? h[1] : null,
             lid: (h[0]==="l") ? h[2] : null };
  },

  answer(q){
    const e = this.build(), ctx = this.context();
    const boost = d => (ctx.lid && d.meta.lid === ctx.lid) ? 1.5
                     : (ctx.mid && d.meta.mid === ctx.mid) ? 1.2 : 1;

    /* "test me" is generated, not retrieved */
    if(/בחן|תבחן|שאלות|מבחן|תרגל|שאל אותי/.test(q)){
      const m = ctx.mid ? modById(ctx.mid) : null;
      const pool = m ? m.quiz : MODS.flatMap(x => x.quiz);
      if(pool.length){
        const pick = shuffle(pool).slice(0,3);
        return {ok:true, html:
          '<div class="tut-lead">בוא נבחן אותך'+(m ? " על "+esc(m.title) : "")+':</div>'+
          pick.map((qq,i) =>
            '<div class="tut-q"><b>'+(i+1)+'. '+esc(qq.q)+'</b>'+
            '<div class="tut-ans">✅ '+esc(qq.opts[qq.a])+'</div>'+
            '<div class="tut-exp">'+esc(qq.exp)+'</div></div>').join("")+
          '<div class="tut-foot">לסבב מלא — לשונית הבוחן במודול.</div>'};
      }
    }

    const res = e.ask(q, {boost:boost, related:3});
    if(!res.ok) return {ok:false, reason:res.reason};

    const a = res.answer;
    const where = d => (d.meta.mod||"") + (d.meta.lesson ? " › " + d.meta.lesson : "");
    const link = d => '<a class="tut-link" href="'+d.url+'" onclick="closeChat()">'+esc(where(d))+'</a>';

    let html = '<div class="tut-lead">'+esc(a.lead)+'</div><div class="tut-card">'+
      (a.doc.html ? a.doc.html
                  : '<p>'+esc(a.doc.text.slice(0,700))+(a.doc.text.length>700?"…":"")+'</p>')+
      '<div class="tut-src">📍 '+link(a.doc)+'</div></div>';
    if(a.related.length){
      html += '<div class="tut-more"><b>קשור לזה</b>'+a.related.map(d =>
        '<div class="tut-rel">'+link(d)+'<span>'+
        esc(d.text.replace(/\s+/g," ").slice(0,95))+'…</span></div>').join("")+'</div>';
    }
    return {ok:true, html:html, intent:res.intent, confidence:res.confidence};
  }
};
