#!/usr/bin/env python3
"""What would each retrieval-based rule for judgment-only answers cost? Reads saved runs (no model calls):
answers_lay_groq2 + answers_scen_groq2 (answerable, 36 answered), answers_lay_groq_nogen (the 3 trap leaks, general tier off),
and answers_baseline (the 55 judgment questions: 29 real answered, 2 trap leaks). For each rule and bar x it prints how many
leaked traps it would stop and how many answered real questions it would lose. Used for the 2026-10-22 decision in DECISIONS.md.

    python3 tools/judgment_rule_costs.py        (reads $CHAMBERS_DATA_DIR-style path below)
"""
import json
import os
E = os.path.join(os.environ.get("CHAMBERS_DATA_DIR", "."), "corpus", "eval") + "/"
def is_j(c): return ("S.C.R" in c) or (" v. " in c and "Supreme" in c)
def feats(r):
    d=r["debug"]; j=d.get("judgments") or []; top=[x[1] for x in (d.get("top") or [])]
    th=d.get("threshold"); cj=[c for c in r["citations"] if is_j(c)]; cs=[c for c in r["citations"] if not is_j(c)]
    csims=[s for c in cj for (n,s) in j if n==c]
    return dict(id=r["id"],reliable=bool(top) and top[0]>=th,nstat=len(top),jmax=max([x[1] for x in j],default=0),
                cites_j=len(cj),cites_s=len(cs),csims=csims,jonly_sources=(len(top)==0))
def answered(tag,types):
    out=[]
    for r in json.load(open(E+f"answers_{tag}.json")):
        d=r.get("debug") or {}
        if r.get("error") or r["refused"] or d.get("general") or r["type"] not in types: continue
        out.append(feats(r))
    return out
L=answered("lay_groq2",("answerable","scenario"))+answered("scen_groq2",("answerable","scenario"))
LT=[f for f in answered("lay_groq_nogen",("trap",))]            # traps answered with tier 2 off (the 3 leaks)
JA=answered("baseline",("find_case","point")); JT=answered("baseline",("trap",))+[f for f in answered("after",("trap",)) if f["id"] not in {x["id"] for x in answered("baseline",("trap",))}]
print("answered: lay+scen real",len(L),"| lay traps leaked",[f["id"] for f in LT],"| judgment-set real",len(JA),"| judgment-set traps leaked",[f["id"] for f in JT])
print("judgment-set leaked traps:",[(f["id"],f["jmax"],f["csims"],f["nstat"]) for f in JT])
cands={
 "A: no reliable statute -> max judgment sim >= x":lambda f,x: f["reliable"] or f["jmax"]>=x,
 "A2: no statute among the sources at all -> max judgment sim >= x":lambda f,x: not f["jonly_sources"] or f["jmax"]>=x,
 "B: answer cites only judgments -> max cited sim >= x":lambda f,x: f["cites_s"]>0 or not f["csims"] or max(f["csims"])>=x,
 "B2: answer cites only judgments -> min cited sim >= x":lambda f,x: f["cites_s"]>0 or not f["csims"] or min(f["csims"])>=x,
 "B3: ANY cited judgment (even with statutes) -> min cited sim >= x":lambda f,x: not f["csims"] or min(f["csims"])>=x,
}
print(f'\n{"rule":68s}{"x":>6s}{"lay traps caught/3":>20s}{"judg traps caught/"+str(len(JT)):>22s}{"lost lay+scen/"+str(len(L)):>18s}{"lost judg/"+str(len(JA)):>14s}')
for name,fn in cands.items():
    for x in (0.60,0.62,0.64,0.65,0.66,0.67,0.68):
        keep=lambda f: fn(f,x)
        c1=sum(not keep(f) for f in LT); c2=sum(not keep(f) for f in JT)
        l1=[f["id"] for f in L if not keep(f)]; l2=[f["id"] for f in JA if not keep(f)]
        print(f'{name:68s}{x:6.2f}{c1:20d}{c2:22d}{len(l1):18d}{len(l2):14d}   lost: {l1} {l2[:6]}{"..." if len(l2)>6 else ""}')
    print()
# structural
D=lambda f: not f["jonly_sources"]
print("D: judgment-only sources -> never answer: lay traps caught",sum(not D(f) for f in LT),"| judg traps caught",sum(not D(f) for f in JT),"| lost lay+scen",[f["id"] for f in L if not D(f)],"| lost judg",len([f for f in JA if not D(f)]),"of",len(JA))
