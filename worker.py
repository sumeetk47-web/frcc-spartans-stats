import base64
import json
import os
import re
import threading
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import requests

API_BASE = "https://core-prod-origin.cricclubs.com/core"
APP_VERSION = "4.0.536"

CLUB_ID = int(os.getenv("CRICCLUBS_CLUB_ID", "5135"))
SERIES_ID = int(os.getenv("CRICCLUBS_SERIES_ID", "135"))
TEAM_ID = int(os.getenv("CRICCLUBS_TEAM_ID", "1202"))
TEAM_NAME = os.getenv("CRICCLUBS_TEAM_NAME", "FRCC-Spartans")
SEASON = int(os.getenv("CRICCLUBS_SEASON", "2026"))
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "0.35"))

# Same public key currently used by the CricClubs web app.
PUBKEY_B64 = (
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCNokj65NYc9LdYZshBi6I1BUVu8Ndh"
    "cafSkzSugFVwUydw7t2DPaZcewxkko3G2R/0OS8s7ceSV/p4zljtgCNtls5A6TT2Ehso"
    "xhqh6PHRRuK4gvhPn8gYtBXjQHkj0VWkr9VoPdEt3NQIr0MkBmwAgt5YkTCV1EZPOAn"
    "sLSnQrwIDAQAB"
)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

def _der_len(d, i):
    n = d[i]; i += 1
    if n < 0x80:
        return n, i
    k = n & 0x7f
    return int.from_bytes(d[i:i+k], "big"), i+k

def _parse_spki(der):
    i = 0
    assert der[i] == 0x30
    _, i = _der_len(der, i+1)
    assert der[i] == 0x30
    al, j = _der_len(der, i+1); i = j + al
    assert der[i] == 0x03
    _, i = _der_len(der, i+1)
    assert der[i] == 0; i += 1
    assert der[i] == 0x30
    _, i = _der_len(der, i+1)
    assert der[i] == 0x02
    nl, i = _der_len(der, i+1)
    n = int.from_bytes(der[i:i+nl], "big"); i += nl
    assert der[i] == 0x02
    el, i = _der_len(der, i+1)
    e = int.from_bytes(der[i:i+el], "big")
    return n, e

_N, _E = _parse_spki(base64.b64decode(PUBKEY_B64))
_K = (_N.bit_length() + 7) // 8

def content_token():
    msg = ("core-" + str(int(time.time() * 1000))).encode()
    ps = bytearray()
    while len(ps) < _K - 3 - len(msg):
        b = os.urandom(1)
        if b != b"\x00":
            ps += b
    em = b"\x00\x02" + bytes(ps) + b"\x00" + msg
    c = pow(int.from_bytes(em, "big"), _E, _N)
    return base64.b64encode(c.to_bytes(_K, "big")).decode()

SESSION = requests.Session()
SESSION.headers.update({
    "x-content-token": "", "User-Agent": UA,
    "Referer": "https://app.cricclubs.com/",
    "Accept": "application/json, text/plain, */*",
})

def api_get(path):
    url = urljoin(API_BASE + "/", path.lstrip("/"))
    headers = dict(SESSION.headers)
    headers["x-content-token"] = content_token()
    r = SESSION.get(url, headers=headers, timeout=25)
    r.raise_for_status()
    return r.json()

def recursive_objects(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from recursive_objects(v)
    elif isinstance(x, list):
        for v in x:
            yield from recursive_objects(v)

def first_value(obj, keys, default=None):
    wanted = {k.lower() for k in keys}
    for d in recursive_objects(obj):
        for k, v in d.items():
            if k.lower() in wanted and v not in (None, ""):
                return v
    return default

def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def team_in_text(obj):
    target = norm(TEAM_NAME)
    return target in norm(json.dumps(obj, ensure_ascii=False))

def get_schedule():
    return api_get(f"/match/getSchedule?v={APP_VERSION}&clubId={CLUB_ID}&seriesId={SERIES_ID}&limit=200")

def extract_matches(schedule):
    candidates = []
    for d in recursive_objects(schedule):
        # Accept objects that look like fixtures/matches.
        mid = first_value(d, ["matchId", "matchID", "id"])
        fid = first_value(d, ["fixtureId", "fixtureID", "scheduleId"])
        if mid is None and fid is None:
            continue
        blob = norm(d)
        if norm(TEAM_NAME) not in blob and str(TEAM_ID) not in blob:
            continue
        date = first_value(d, ["matchDate", "date", "startDate", "scheduledDate", "matchStartDate"])
        year = None
        if date:
            m = re.search(r"(20\d{2})", str(date))
            year = int(m.group(1)) if m else None
        if year and year != SEASON:
            continue
        candidates.append(d)

    # Deduplicate by fixture/match id.
    out, seen = [], set()
    for d in candidates:
        key = str(first_value(d, ["fixtureId","fixtureID","matchId","matchID","id"]))
        if key not in seen:
            seen.add(key)
            out.append(d)
    return out

def get_summary(match_id):
    return api_get(f"/scoreCard/getScoreCardSummary?v={APP_VERSION}&clubId={CLUB_ID}&matchId={match_id}")

def get_balls(match_id):
    return api_get(f"/scoreCard/getBallByBall?v={APP_VERSION}&clubId={CLUB_ID}&matchId={match_id}")

def identify_match_id(fixture):
    return first_value(fixture, ["matchId", "matchID", "id"])

def ground_from(summary, fixture):
    return first_value(summary, ["groundName","ground","venueName","venue","location","groundname"]) \
        or first_value(fixture, ["groundName","ground","venueName","venue","location"]) \
        or "Unknown"

def match_date(summary, fixture):
    return first_value(summary, ["matchDate","date","matchDateTime","startDate"]) \
        or first_value(fixture, ["matchDate","date","startDate","scheduledDate"])

def team_names(summary):
    vals = []
    for k in ["team1Name","team2Name","team1","team2","teamName"]:
        v = first_value(summary, [k])
        if isinstance(v, str) and v not in vals:
            vals.append(v)
    # fallback: scan obvious team-like keys
    if len(vals) < 2:
        for d in recursive_objects(summary):
            for k,v in d.items():
                if "team" in k.lower() and isinstance(v, str) and v not in vals:
                    vals.append(v)
    return vals[:2]

def parse_int(v, default=0):
    try:
        return int(float(str(v).replace(",", "").strip()))
    except Exception:
        return default

def extract_official_batting(summary):
    """Extract batting rows exposed by getScoreCardSummary.

    CricClubs only exposes the top three batters in the summary.  Those
    figures are authoritative and are used to correct/reconcile the
    ball-by-ball reconstruction when a player appears there.
    """
    rows = []
    seen = set()
    name_keys = {"batsmanname", "battername", "playername", "batsman", "batter", "name"}
    run_keys = {"runs", "batsmanruns", "batterruns", "battingruns", "runsscored"}
    ball_keys = {"balls", "ballsplayed", "ballsface", "ballsFaced".lower()}
    four_keys = {"fours", "four", "boundaries4", "fourscount"}
    six_keys = {"sixes", "six", "boundaries6", "sixescount"}
    sr_keys = {"strikerate", "sr"}
    out_keys = {"out", "dismissed", "isout", "outstatus"}

    for d in recursive_objects(summary):
        if not isinstance(d, dict):
            continue
        lower = {str(k).lower(): v for k, v in d.items()}
        name = next((v for k, v in lower.items() if k in name_keys and isinstance(v, str) and v.strip()), None)
        runs = next((v for k, v in lower.items() if k in run_keys and v not in (None, "")), None)
        balls = next((v for k, v in lower.items() if k in ball_keys and v not in (None, "")), None)
        fours = next((v for k, v in lower.items() if k in four_keys and v not in (None, "")), None)
        sixes = next((v for k, v in lower.items() if k in six_keys and v not in (None, "")), None)
        sr = next((v for k, v in lower.items() if k in sr_keys and v not in (None, "")), None)
        if name is None or runs is None or balls is None:
            continue
        # Avoid treating generic summary totals as player rows.
        if norm(name) in {"total", "extras", "fallofwickets", "yetotbat"}:
            continue
        key = norm(name)
        if not key or key in seen:
            continue
        seen.add(key)
        out_val = next((v for k, v in lower.items() if k in out_keys), None)
        dismissed = bool(out_val) if isinstance(out_val, bool) else bool(out_val and str(out_val).lower() not in {"not out", "notout", "no", "false", "0"})
        rows.append({
            "name": str(name).strip(),
            "runs": parse_int(runs),
            "balls": parse_int(balls),
            "fours": parse_int(fours) if fours is not None else None,
            "sixes": parse_int(sixes) if sixes is not None else None,
            "strike_rate": float(sr) if sr not in (None, "") and re.match(r"^[\d.]+$", str(sr)) else None,
            "dismissed": dismissed,
        })
    return rows

def match_batter_name(official_name, candidates):
    """Match a full summary name to CricClubs' abbreviated ball-feed name."""
    target = norm(official_name)
    if not target:
        return None
    for c in candidates:
        if norm(c) == target:
            return c
    # CricClubs commonly abbreviates the final name component to an initial.
    ot = str(official_name).strip().lower().split()
    for c in candidates:
        ct = str(c).strip().lower().split()
        if len(ct) == len(ot) and all(a == b or (len(b) == 1 and a.startswith(b)) or (len(a) == 1 and b.startswith(a)) for a, b in zip(ot, ct)):
            return c
        if len(ct) < len(ot) and all(a == b or (len(b) == 1 and a.startswith(b)) for a, b in zip(ot, ct)):
            return c
    return None

def parse_ballfeed(data):
    """Reconstruct full innings from CricClubs getBallByBall.

    CricClubs stores deliveries under inningsN.oversMap.OverN.balls; the
    previous implementation incorrectly looked for innings-level balls.
    """
    innings = []
    for key in ("innings1Balls", "innings2Balls"):
        for d in recursive_objects(data):
            if key in d and isinstance(d[key], dict):
                innings.append((key, d[key]))
                break

    results = []
    for label, inn in innings:
        overs_map = inn.get("oversMap") or {}
        if not isinstance(overs_map, dict):
            continue

        batting = defaultdict(lambda: {
            "runs": 0, "balls": 0, "fours": 0, "sixes": 0,
            "dismissed": False, "how_out": ""
        })
        batting_order = []
        bowling = {}

        def batter(name):
            if not name:
                return None
            name = str(name).strip()
            if name not in batting:
                batting[name]
                batting_order.append(name)
            return batting[name]

        def ball_kind(b):
            bt = str(b.get("ballType", ""))
            rd = str(b.get("runsDisplay", ""))
            return {
                "wide": bool(re.search(r"wide|wd", bt, re.I) or re.search(r"wd", rd, re.I)),
                "nb": bool(re.search(r"no\s*ball|nb", bt, re.I) or re.search(r"nb", rd, re.I)),
                "bye": bool(re.search(r"bye", bt, re.I)),
                "wicket": bool(re.search(r"W", rd.replace("wd", ""), re.I)),
            }

        def apply_out_commentary(b):
            commentary = str(b.get("commentary", "") or "")
            # CricClubs uses HTML commentary such as:
            # <strong>Player c Fielder b Bowler 8</strong>
            # (5balls 0 fours, 1 sixes) SR 160.00
            m = re.search(
                r"<strong>(.*?)</strong>\s*\((\d+)\s*balls?\s+(\d+)\s*fours?,\s*(\d+)\s*six\w*\)\s*SR\s*([\d.]+)",
                commentary, re.I | re.S,
            )
            if not m:
                return None
            import html
            body = re.sub(r"<[^>]+>", " ", m.group(1))
            body = html.unescape(body)
            words = body.strip().split()
            runs = None
            if words and words[-1].isdigit():
                runs = int(words.pop())
            seen = set(batting.keys())
            matched = None
            for nwords in range(min(4, len(words)), 1, -1):
                candidate = " ".join(words[:nwords-1] + [words[nwords-1][:1]])
                if candidate in seen:
                    matched = candidate
                    break
            if not matched:
                striker = b.get("strikerName") or b.get("batsmanName")
                matched = striker if striker in seen else None
            if matched:
                x = batter(matched)
                x["dismissed"] = True
                x["how_out"] = " ".join(words[len(matched.split()):]).strip() or "out"
                if runs is not None:
                    x["runs"] = runs
                x["balls"] = parse_int(m.group(2))
                x["fours"] = parse_int(m.group(3))
                x["sixes"] = parse_int(m.group(4))
                x["sr"] = m.group(5)
                return matched
            return None

        # Over entries contain both the delivery feed and the authoritative
        # running bowling totals. Process in chronological order.
        over_items = []
        for key, over in overs_map.items():
            if not isinstance(over, dict):
                continue
            try:
                over_no = int(re.sub(r"[^0-9]", "", str(key)) or 0)
            except Exception:
                over_no = 0
            over_items.append((over_no, key, over))
        over_items.sort(key=lambda x: x[0])

        for _, _, over in over_items:
            bowler_name = over.get("bowlerName")
            if bowler_name:
                name = str(bowler_name).strip()
                bowling[name] = {
                    "balls": parse_int(over.get("bowlerBalls")),
                    "maidens": parse_int(over.get("bowlerMaidens")),
                    "runs": parse_int(over.get("bowlerRuns")),
                    "wickets": parse_int(over.get("bowlerWickets")),
                }

            balls = over.get("balls") or over.get("ballList") or []
            if isinstance(balls, dict):
                balls = list(balls.values())
            balls = [b for b in balls if isinstance(b, dict)]
            balls = [b for b in balls if str(b.get("ballType", "")).lower() != "auto comment ball"]
            balls.sort(key=lambda b: str(b.get("createdAt", "")))

            for b in balls:
                striker = b.get("strikerName") or b.get("batsmanName") or b.get("batterName")
                non_striker = b.get("nonStrikerName") or b.get("runnerName")
                s = batter(striker)
                batter(non_striker)
                if not s:
                    continue

                kind = ball_kind(b)
                rd = str(b.get("runsDisplay", "")).strip().lower()
                raw_runs = parse_int(b.get("runs", b.get("batsmanRuns", 0)))

                # CricClubs' runsDisplay is a delivery chip.  For batting
                # statistics we need the RUNS OFF THE BAT, not the total
                # delivery runs.  In particular, a no-ball boundary is often
                # displayed as 5nb (4 bat + 1 no-ball), while a bye/leg-bye is
                # displayed as 1b/1lb and must contribute zero to the batter.
                runs = raw_runs
                chip_batter_runs = None
                m_rd = re.match(r"^(\d+)(wd|nb|b|lb)?$", rd)
                if m_rd:
                    chip_runs = int(m_rd.group(1))
                    suffix = m_rd.group(2) or ""
                    if suffix in {"wd", "b", "lb"}:
                        chip_batter_runs = 0
                    elif suffix == "nb":
                        chip_batter_runs = max(0, chip_runs - 1)
                    else:
                        chip_batter_runs = chip_runs
                elif rd in {".", "w"}:
                    chip_batter_runs = 0

                if chip_batter_runs is not None:
                    runs = chip_batter_runs
                elif kind["nb"]:
                    # When the chip is unavailable, b.runs is the delivery
                    # total in CricClubs feeds, so remove the no-ball extra.
                    runs = max(0, raw_runs - 1)
                elif kind["wide"] or kind["bye"]:
                    runs = 0

                if not kind["wide"]:
                    s["balls"] += 1
                    if not kind["bye"]:
                        s["runs"] += runs
                        # Boundary counts must use batter runs specifically.
                        # This correctly handles 4, 6, 5nb (4+1), 7nb (6+1),
                        # and excludes byes/leg-byes/wides.
                        if runs == 4:
                            s["fours"] += 1
                        elif runs == 6:
                            s["sixes"] += 1

                if kind["wicket"]:
                    apply_out_commentary(b)

        # Mark wickets from a dismissal commentary even when runsDisplay isn't W.
        # This is a fallback for older CricClubs feeds.
        for b in batting.values():
            b["dismissed"] = bool(b.get("dismissed"))

        results.append({
            "team": inn.get("teamName") or first_value(inn, ["teamName"]) or "",
            "batting": {name: batting[name] for name in batting_order},
            "bowling": bowling,
            "raw": inn,
        })
    return results

def is_spartans(name):
    return norm(TEAM_NAME) in norm(name) or norm(name) in norm(TEAM_NAME)

def run_job(job_id, jobs, lock):
    outdir = Path("data") / job_id
    outdir.mkdir(parents=True, exist_ok=True)
    def update(status=None, progress=None, message=None):
        with lock:
            j = jobs.setdefault(job_id, {})
            if status: j["status"] = status
            if progress is not None: j["progress"] = progress
            if message: j["message"] = message
    try:
        update("running", 3, "Fetching 2026 schedule…")
        schedule = get_schedule()
        fixtures = extract_matches(schedule)
        if not fixtures:
            raise RuntimeError(
                "No FRCC-Spartans fixtures were found in the API response. "
                "If CricClubs changed its schedule schema, inspect data/raw_schedule.json."
            )
        (outdir/"raw_schedule.json").write_text(json.dumps(schedule, indent=2, ensure_ascii=False), encoding="utf-8")

        matches = []
        batting_rows = []
        bowling_rows = []
        errors = []
        data_quality_rows = []

        for i, fixture in enumerate(fixtures, 1):
            mid = identify_match_id(fixture)
            pct = 5 + int(85 * (i-1)/max(1,len(fixtures)))
            update(progress=pct, message=f"Processing match {i}/{len(fixtures)} (ID {mid})…")
            if not mid:
                errors.append({"fixture": fixture, "error":"No matchId"})
                continue
            try:
                summary = get_summary(mid)
                time.sleep(REQUEST_DELAY)
                balls = get_balls(mid)
                time.sleep(REQUEST_DELAY)
                ground = ground_from(summary, fixture)
                teams = team_names(summary)
                result = first_value(summary, ["result","matchResult","winner","winningTeam"])
                dt = match_date(summary, fixture)

                match_record = {
                    "match_id": mid, "date": dt, "ground": ground,
                    "teams": " vs ".join(teams), "result": result,
                }
                matches.append(match_record)

                official_batting = extract_official_batting(summary)
                for inn in parse_ballfeed(balls):
                    batting_team = inn["team"]
                    batting_team = inn.get("team") or "Unknown"
                    # Reconcile any batter exposed by the official summary.
                    # The summary is authoritative for those rows; the ball feed
                    # remains the source for everyone else.
                    for official in official_batting:
                        matched = match_batter_name(official["name"], inn["batting"].keys())
                        if matched:
                            calc = inn["batting"][matched]
                            if (official.get("runs") is not None and calc["runs"] != official["runs"]) or (official.get("balls") is not None and calc["balls"] != official["balls"]) or (official.get("fours") is not None and calc["fours"] != official["fours"]) or (official.get("sixes") is not None and calc["sixes"] != official["sixes"]):
                                data_quality_rows.append({
                                    "match_id": mid, "date": dt, "ground": ground,
                                    "team": batting_team, "player": official["name"],
                                    "official_runs": official["runs"], "calculated_runs": calc["runs"],
                                    "difference": official["runs"] - calc["runs"],
                                    "official_balls": official["balls"], "calculated_balls": calc["balls"],
                                    "official_fours": official.get("fours"), "calculated_fours": calc["fours"],
                                    "official_sixes": official.get("sixes"), "calculated_sixes": calc["sixes"],
                                    "source": "CricClubs scorecard summary"
                                })
                            # The scorecard is authoritative field-by-field.
                            # Only replace a calculated value when CricClubs actually
                            # supplied that field; a missing field must not become 0.
                            for field in ("runs", "balls", "fours", "sixes"):
                                if official.get(field) is not None:
                                    calc[field] = official[field]
                            calc["dismissed"] = official["dismissed"] or calc.get("dismissed", False)
                            if official.get("strike_rate") is not None:
                                calc["sr"] = official["strike_rate"]
                    bowling_team = "Unknown"
                    if len(teams) >= 2:
                        bowling_team = next((t for t in teams if norm(t) != norm(batting_team)), "Unknown")
                    for player, x in inn["batting"].items():
                        sr = round(100*x["runs"]/x["balls"], 2) if x["balls"] else 0
                        batting_rows.append({
                            "match_id":mid,"date":dt,"ground":ground,
                            "team":batting_team,"opponent":bowling_team,
                            "player":player,"runs":x["runs"],"balls":x["balls"],
                            "fours":x["fours"],"sixes":x["sixes"],"strike_rate":sr,
                            "dismissed":x["dismissed"]
                        })
                    # Bowling figures belong to the team fielding in this innings.
                    for player, x in inn["bowling"].items():
                        b = x["balls"]
                        bowling_rows.append({
                            "match_id":mid,"date":dt,"ground":ground,
                            "team":bowling_team,"opponent":batting_team,
                            "player":player,"balls":b,"overs":f"{b//6}.{b%6}",
                            "maidens":x["maidens"],"runs_conceded":x["runs"],
                            "wickets":x["wickets"],
                            "economy":round(6*x["runs"]/b,2) if b else 0
                        })
            except Exception as e:
                errors.append({"match_id":mid, "error":str(e)})

        bat = pd.DataFrame(batting_rows)
        bowl = pd.DataFrame(bowling_rows)
        mat = pd.DataFrame(matches)

        if bat.empty:
            bat = pd.DataFrame(columns=["team","ground","player","matches","innings","runs","balls","fours","sixes","strike_rate","average","highest_score"])
            bat_inn = bat.copy()
        else:
            bat["out"] = bat["dismissed"].astype(bool)
            bat["not_out"] = ~bat["out"]
            bat_inn = bat.groupby(["team","ground","player"], as_index=False).agg(
                matches=("match_id","nunique"), innings=("match_id","size"),
                runs=("runs","sum"), balls=("balls","sum"),
                fours=("fours","sum"), sixes=("sixes","sum"),
                dismissals=("out","sum"), highest_score=("runs","max"))
            bat_inn["strike_rate"] = (100*bat_inn["runs"]/bat_inn["balls"]).round(2)
            bat_inn["average"] = bat_inn.apply(
                lambda r: round(r["runs"]/r["dismissals"],2) if r["dismissals"] else None, axis=1)
            bat_inn = bat_inn.drop(columns=["dismissals"])

        if bowl.empty:
            bowl_inn = pd.DataFrame(columns=["team","ground","player","matches","innings","balls","overs","maidens","runs_conceded","wickets","economy","average","best_figures"])
        else:
            bowl_inn = bowl.groupby(["team","ground","player"], as_index=False).agg(
                matches=("match_id","nunique"), innings=("match_id","size"),
                balls=("balls","sum"), maidens=("maidens","sum"),
                runs_conceded=("runs_conceded","sum"), wickets=("wickets","sum"))
            bowl_inn["overs"] = bowl_inn["balls"].apply(lambda x:f"{x//6}.{x%6}")
            bowl_inn["economy"] = (6*bowl_inn["runs_conceded"]/bowl_inn["balls"]).round(2)
            bowl_inn["average"] = bowl_inn.apply(
                lambda r: round(r["runs_conceded"]/r["wickets"],2) if r["wickets"] else None, axis=1)
            best = bowl.groupby(["team","ground","player"]).apply(
                lambda g: g.sort_values(["wickets","runs_conceded"], ascending=[False,True]).iloc[0],
                include_groups=False)
            bowl_inn["best_figures"] = [
                f'{int(row["wickets"])}-{int(row["runs_conceded"])}' for _, row in best.iterrows()
            ]

        # Overall player tables
        if bat.empty:
            overall_bat = bat_inn.copy()
        else:
            overall_bat = bat.groupby(["team","player"], as_index=False).agg(
                matches=("match_id","nunique"), innings=("match_id","size"),
                runs=("runs","sum"), balls=("balls","sum"),
                fours=("fours","sum"), sixes=("sixes","sum"),
                dismissals=("out","sum"), highest_score=("runs","max"))
            overall_bat["strike_rate"] = (100*overall_bat["runs"]/overall_bat["balls"]).round(2)
            overall_bat["average"] = overall_bat.apply(
                lambda r: round(r["runs"]/r["dismissals"],2) if r["dismissals"] else None, axis=1)
            overall_bat.drop(columns=["dismissals"], inplace=True)

        if bowl.empty:
            overall_bowl = bowl_inn.copy()
        else:
            overall_bowl = bowl.groupby(["team","player"], as_index=False).agg(
                matches=("match_id","nunique"), innings=("match_id","size"),
                balls=("balls","sum"), maidens=("maidens","sum"),
                runs_conceded=("runs_conceded","sum"), wickets=("wickets","sum"))
            overall_bowl["overs"] = overall_bowl["balls"].apply(lambda x:f"{x//6}.{x%6}")
            overall_bowl["economy"] = (6*overall_bowl["runs_conceded"]/overall_bowl["balls"]).round(2)
            overall_bowl["average"] = overall_bowl.apply(
                lambda r: round(r["runs_conceded"]/r["wickets"],2) if r["wickets"] else None, axis=1)

        ground_summary = mat.groupby("ground", as_index=False).agg(
            matches=("match_id","nunique"))
        result = {
            "config":{"club_id":CLUB_ID,"series_id":SERIES_ID,"team_id":TEAM_ID,
                      "team":TEAM_NAME,"season":SEASON,"format":"Twenty20"},
            "matches":mat.fillna("").to_dict("records"),
            "ground_summary":ground_summary.fillna("").to_dict("records"),
            "ground_batting":bat_inn.fillna("").to_dict("records"),
            "ground_bowling":bowl_inn.fillna("").to_dict("records"),
            "overall_batting":overall_bat.fillna("").to_dict("records"),
            "overall_bowling":overall_bowl.fillna("").to_dict("records"),
            "data_quality": pd.DataFrame(data_quality_rows).fillna("").to_dict("records"),
            "errors":errors
        }
        (outdir/"result.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")

        # Excel
        xlsx = outdir / "FRCC-Spartans-2026-T20.xlsx"
        with pd.ExcelWriter(xlsx, engine="openpyxl") as w:
            mat.to_excel(w, "Matches", index=False)
            ground_summary.to_excel(w, "Ground Summary", index=False)
            bat_inn.to_excel(w, "Ground Batting", index=False)
            bowl_inn.to_excel(w, "Ground Bowling", index=False)
            overall_bat.to_excel(w, "Overall Batting", index=False)
            overall_bowl.to_excel(w, "Overall Bowling", index=False)
            pd.DataFrame(data_quality_rows).to_excel(w, "Data Quality", index=False)
            pd.DataFrame(errors).to_excel(w, "Errors", index=False)
        # Publish the latest successful result as the shared server-side cache.
        cache_dir = Path("data") / "cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / "result.json").write_text(
            (outdir / "result.json").read_text(encoding="utf-8"), encoding="utf-8"
        )
        import shutil
        shutil.copy2(xlsx, cache_dir / "FRCC-Spartans-2026-T20.xlsx")
        update("done", 100, f"Complete — {len(matches)} matches processed.")
    except Exception as e:
        (outdir/"error.txt").write_text(str(e), encoding="utf-8")
        update("error", 100, str(e))
    finally:
        # app.py uses this for single-flight protection.
        try:
            import app
            with lock:
                if getattr(app, "in_progress_job", None) == job_id:
                    app.in_progress_job = None
        except Exception:
            pass
