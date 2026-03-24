"""
scrape_korean_jobs.py
=====================
Single scraper for all major Korean job boards.
Follows the same patterns as scrape_jobs.py (jobspy extractor).

Supported platforms (KOREAN_SITES env var, comma-separated):
  wanted      – 원티드   – public JSON API (no key)
  jumpit      – 점핏     – public JSON API (no key)
  saramin     – 사람인   – official OpenAPI (requires SARAMIN_ACCESS_KEY)
  jobkorea    – 잡코리아 – HTML scraping
  albamon     – 알바몬   – HTML scraping (part-time)
  peoplenjob  – 피플앤잡 – HTML scraping (bilingual/expat)
  albacheon   – 알바천국 – HTML scraping (part-time)
  kowork      – 코워크   – HTML scraping (remote-friendly)
  klik        – 클릭잡   – HTML scraping

Environment variables:
  KOREAN_SITES            comma-separated site names (default: wanted,jumpit,jobkorea)
  KOREAN_SEARCH_TERM      search keyword (default: 개발자)
  KOREAN_RESULTS_WANTED   max results per site per term (default: 50)
  KOREAN_TERM_INDEX       for progress reporting (default: 1)
  KOREAN_TERM_TOTAL       for progress reporting (default: 1)
  KOREAN_OUTPUT_JSON      output file path
  SARAMIN_ACCESS_KEY      required only when saramin is in KOREAN_SITES
  JOBOPS_EMIT_PROGRESS    set to 1 to emit progress events
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlencode

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print(
        "Missing dependencies. Run: pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

# ─── Constants ────────────────────────────────────────────────────────────────

PROGRESS_PREFIX = "JOBOPS_PROGRESS "

COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

JSON_HEADERS = {
    **COMMON_HEADERS,
    "Accept": "application/json, text/plain, */*",
}

ALL_SITES = [
    "wanted",
    "jumpit",
    "saramin",
    "jobkorea",
    "albamon",
    "peoplenjob",
    "albacheon",
    "kowork",
    "klik",
]

# ─── Data model ───────────────────────────────────────────────────────────────

@dataclass
class KoreanJob:
    site: str
    job_url: str
    title: str
    company: str
    location: str | None = None
    salary: str | None = None
    date_posted: str | None = None
    deadline: str | None = None
    description: str | None = None
    job_type: str | None = None
    is_remote: bool | None = None
    skills: str | None = None
    id: str | None = None
    company_logo: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _env_str(name: str, default: str) -> str:
    v = os.getenv(name, "").strip()
    return v if v else default


def _env_int(name: str, default: int) -> int:
    v = os.getenv(name, "").strip()
    try:
        return int(v) if v else default
    except ValueError:
        return default


def _emit_progress(event: str, payload: dict[str, Any]) -> None:
    if os.getenv("JOBOPS_EMIT_PROGRESS") != "1":
        return
    line = json.dumps({"event": event, **payload}, ensure_ascii=True)
    print(f"{PROGRESS_PREFIX}{line}", flush=True)


def _parse_sites(raw: str) -> list[str]:
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


def _clean(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = " ".join(text.split())
    return cleaned if cleaned else None


def _get(session: requests.Session, url: str, **kwargs: Any) -> requests.Response:
    """GET with a short retry on transient errors."""
    for attempt in range(3):
        try:
            resp = session.get(url, timeout=15, **kwargs)
            if resp.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            return resp
        except requests.RequestException as exc:
            if attempt == 2:
                raise
            time.sleep(1)
    raise RuntimeError(f"Failed to GET {url}")


# ─── Wanted (원티드) ──────────────────────────────────────────────────────────

def _scrape_wanted(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    offset = 0
    limit = min(100, max_results)

    while len(jobs) < max_results:
        url = (
            f"https://www.wanted.co.kr/api/v4/jobs"
            f"?country=kr&job_sort=job.latest_order&years=-1"
            f"&keyword={quote_plus(keyword)}&limit={limit}&offset={offset}"
        )
        resp = _get(session, url, headers={
            **JSON_HEADERS,
            "Referer": "https://www.wanted.co.kr/",
        })
        if not resp.ok:
            break

        data = resp.json()
        items = data.get("data") or []
        if not items:
            break

        for item in items:
            if len(jobs) >= max_results:
                break
            job_id = str(item.get("id", ""))
            if not job_id:
                continue
            jobs.append(KoreanJob(
                site="wanted",
                id=job_id,
                title=_clean(item.get("position")) or "Unknown Title",
                company=_clean(item.get("company", {}).get("name")) or "Unknown Company",
                job_url=f"https://www.wanted.co.kr/wd/{job_id}",
                location=_clean(
                    item.get("address", {}).get("location")
                    or item.get("address", {}).get("country")
                ),
                deadline=_clean(str(item.get("due_time", "") or "")),
                company_logo=item.get("company", {}).get("logo_img", {}).get("thumb"),
            ))

        if not data.get("links", {}).get("next_url") or len(items) < limit:
            break
        offset += len(items)

    return jobs


# ─── Jumpit (점핏) ────────────────────────────────────────────────────────────

def _scrape_jumpit(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1
    size = 20

    while len(jobs) < max_results:
        url = (
            f"https://jumpit.saramin.co.kr/api/position"
            f"?keyword={quote_plus(keyword)}&sort=relation&page={page}&size={size}"
        )
        resp = _get(session, url, headers={
            **JSON_HEADERS,
            "Referer": "https://jumpit.saramin.co.kr/",
        })
        if not resp.ok:
            break

        data = resp.json()
        positions = (data.get("result") or {}).get("positions") or []
        total = (data.get("result") or {}).get("totalCount") or 0
        if not positions:
            break

        for pos in positions:
            if len(jobs) >= max_results:
                break
            job_id = str(pos.get("id", ""))
            if not job_id:
                continue

            locations = pos.get("locations") or []
            location_str = ", ".join(str(loc) for loc in locations if loc) or None

            stacks = pos.get("techStacks") or []
            skills_str = ", ".join(
                s.get("title", "") for s in stacks if s.get("title")
            ) or None

            due = pos.get("dueDate")
            deadline = "상시채용" if pos.get("alwaysOpen") else _clean(str(due or ""))

            jobs.append(KoreanJob(
                site="jumpit",
                id=job_id,
                title=_clean(pos.get("title")) or "Unknown Title",
                company=_clean(pos.get("companyName")) or "Unknown Company",
                job_url=f"https://jumpit.saramin.co.kr/position/{job_id}",
                location=location_str,
                job_type=_clean(pos.get("employType") or pos.get("career")),
                deadline=deadline,
                skills=skills_str,
            ))

        if len(jobs) >= total or len(positions) < size:
            break
        page += 1

    return jobs


# ─── Saramin (사람인) — official OpenAPI ─────────────────────────────────────

def _scrape_saramin(
    session: requests.Session,
    keyword: str,
    max_results: int,
    access_key: str,
    loc_mcd: str | None = None,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    start = 0
    count = min(110, max_results)

    while len(jobs) < max_results:
        params: dict[str, str] = {
            "access-key": access_key,
            "keywords": keyword,
            "start": str(start),
            "count": str(min(count, max_results - len(jobs))),
            "fields": "base,salary,job-type,expiration-date",
        }
        if loc_mcd:
            params["loc_mcd"] = loc_mcd

        resp = _get(
            session,
            f"https://oapi.saramin.co.kr/job-search?{urlencode(params)}",
            headers={**JSON_HEADERS, "Referer": "https://www.saramin.co.kr/"},
        )
        if not resp.ok:
            break

        data = resp.json()
        items = (data.get("jobs") or {}).get("job") or []
        if not items:
            break

        for item in items:
            if len(jobs) >= max_results:
                break
            url = item.get("url")
            if not url:
                continue

            posted_ts = item.get("posting-timestamp")
            date_posted = None
            if posted_ts:
                try:
                    from datetime import datetime, timezone
                    date_posted = datetime.fromtimestamp(
                        int(posted_ts), tz=timezone.utc
                    ).strftime("%Y-%m-%d")
                except Exception:
                    pass

            jobs.append(KoreanJob(
                site="saramin",
                id=str(item.get("id", "")),
                title=_clean((item.get("position") or {}).get("title")) or "Unknown Title",
                company=_clean(
                    (item.get("company") or {}).get("detail", {}).get("name")
                ) or "Unknown Company",
                job_url=url,
                location=_clean(
                    (item.get("position") or {}).get("location", {}).get("name")
                ),
                salary=_clean((item.get("salary") or {}).get("name")),
                job_type=_clean(
                    (item.get("position") or {}).get("job-type", {}).get("name")
                ),
                date_posted=date_posted,
                deadline=_clean(str(item.get("expiration-date") or "")),
            ))

        if len(items) < count:
            break
        start += len(items)

    return jobs


# ─── JobKorea (잡코리아) ──────────────────────────────────────────────────────

def _scrape_jobkorea(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = (
            f"https://www.jobkorea.co.kr/Search/"
            f"?stext={quote_plus(keyword)}&tabType=recruit&Page_No={page}"
        )
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://www.jobkorea.co.kr/",
        })
        if not resp.ok:
            break

        soup = BeautifulSoup(resp.text, "lxml")

        # JobKorea wraps listings in <article class="list-item">
        cards = soup.select("article.list-item") or soup.select("li.list-item")
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.title, a.job-name, .tit a")
            company_el = card.select_one("a.name, .corp-name a, .company a")
            location_el = card.select_one(".option .loc, .work-place, .location")
            salary_el = card.select_one(".option .pay, .salary")
            deadline_el = card.select_one(".option .date, .deadline")

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://www.jobkorea.co.kr{href}"

            jobs.append(KoreanJob(
                site="jobkorea",
                title=title,
                company=company,
                job_url=href or f"https://www.jobkorea.co.kr/Search/?stext={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                deadline=_clean(deadline_el.get_text()) if deadline_el else None,
            ))

        if len(cards) < 10:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── Albamon (알바몬) ─────────────────────────────────────────────────────────

def _scrape_albamon(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = f"https://www.albamon.com/jobs/search?kwd={quote_plus(keyword)}&page={page}"
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://www.albamon.com/",
        })
        if not resp.ok:
            break

        soup = BeautifulSoup(resp.text, "lxml")
        cards = (
            soup.select("li.item")
            or soup.select("div.item")
            or soup.select("article.job-item")
        )
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.tit, .job-title a, h3 a, h4 a")
            company_el = card.select_one(".corp, .company-name, strong.name")
            location_el = card.select_one(".location, .area, .work-place")
            salary_el = card.select_one(".pay, .salary, .wage")
            deadline_el = card.select_one(".period, .deadline, .date")

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://www.albamon.com{href}"

            jobs.append(KoreanJob(
                site="albamon",
                title=title,
                company=company,
                job_url=href or f"https://www.albamon.com/jobs/search?kwd={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                deadline=_clean(deadline_el.get_text()) if deadline_el else None,
            ))

        if len(cards) < 5:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── PeopleNJob (피플앤잡) ────────────────────────────────────────────────────

def _scrape_peoplenjob(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = f"https://www.peoplenjob.com/job/list?keyword={quote_plus(keyword)}&pageNo={page}"
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://www.peoplenjob.com/",
        })
        if not resp.ok:
            break

        soup = BeautifulSoup(resp.text, "lxml")
        cards = (
            soup.select("tr.list-item")
            or soup.select("div.job-item")
            or soup.select("li.job-item")
        )
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.title, td.title a, .job-title a")
            company_el = card.select_one("td.company, .company-name, .corp")
            location_el = card.select_one("td.location, .location, .area")
            salary_el = card.select_one("td.salary, .salary")
            deadline_el = card.select_one("td.deadline, .deadline, .date")

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://www.peoplenjob.com{href}"

            jobs.append(KoreanJob(
                site="peoplenjob",
                title=title,
                company=company,
                job_url=href or f"https://www.peoplenjob.com/job/list?keyword={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                deadline=_clean(deadline_el.get_text()) if deadline_el else None,
            ))

        if len(cards) < 5:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── Albacheon / Alba Heaven (알바천국) ───────────────────────────────────────

def _scrape_albacheon(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = f"https://www.alba.co.kr/job/list.asp?page={page}&searchKeyword={quote_plus(keyword)}"
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://www.alba.co.kr/",
        })
        if not resp.ok:
            break

        # alba.co.kr may serve EUC-KR – requests usually auto-detects but let's be safe
        resp.encoding = resp.apparent_encoding or "utf-8"
        soup = BeautifulSoup(resp.text, "lxml")

        cards = (
            soup.select("li.job-card")
            or soup.select("div.job-item")
            or soup.select("li.recruit-item")
            or soup.select("article")
        )
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.job-tit, .tit a, h3 a, h4 a, strong a")
            company_el = card.select_one(".company, strong.company, .corp-name")
            location_el = card.select_one(".area, .location, .work-place")
            salary_el = card.select_one(".pay, .salary, .wage")
            deadline_el = card.select_one(".date, .deadline, .period")

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://www.alba.co.kr{href}"

            jobs.append(KoreanJob(
                site="albacheon",
                title=title,
                company=company,
                job_url=href or f"https://www.alba.co.kr/job/list.asp?searchKeyword={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                deadline=_clean(deadline_el.get_text()) if deadline_el else None,
            ))

        if len(cards) < 5:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── Kowork (코워크) ──────────────────────────────────────────────────────────

def _scrape_kowork(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = f"https://kowork.net/search?q={quote_plus(keyword)}&page={page}"
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://kowork.net/",
        })
        if not resp.ok:
            break

        soup = BeautifulSoup(resp.text, "lxml")
        cards = (
            soup.select("div.job-card")
            or soup.select("article.job")
            or soup.select("li.job-item")
        )
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.job-title, .title a, h2 a, h3 a")
            company_el = card.select_one(".company, .employer, .corp")
            location_el = card.select_one(".location, .area")
            salary_el = card.select_one(".salary, .pay")
            is_remote = bool(card.select_one(".remote, .reomte") or
                             "재택" in card.get_text() or
                             "remote" in card.get_text().lower())

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://kowork.net{href}"

            jobs.append(KoreanJob(
                site="kowork",
                title=title,
                company=company,
                job_url=href or f"https://kowork.net/search?q={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                is_remote=is_remote or None,
            ))

        if len(cards) < 5:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── Klik (클릭잡) ────────────────────────────────────────────────────────────

def _scrape_klik(
    session: requests.Session,
    keyword: str,
    max_results: int,
) -> list[KoreanJob]:
    jobs: list[KoreanJob] = []
    page = 1

    while len(jobs) < max_results:
        url = f"https://klik.co.kr/search?keyword={quote_plus(keyword)}&page={page}"
        resp = _get(session, url, headers={
            **COMMON_HEADERS,
            "Referer": "https://klik.co.kr/",
        })
        if not resp.ok:
            break

        soup = BeautifulSoup(resp.text, "lxml")
        cards = (
            soup.select("li.recruit")
            or soup.select("div.job-item")
            or soup.select("article.recruit")
        )
        if not cards:
            break

        for card in cards:
            if len(jobs) >= max_results:
                break

            title_el = card.select_one("a.job-title, .tit a, h3 a, strong a")
            company_el = card.select_one("p.company, .corp, .company-name")
            location_el = card.select_one(".area, .location, .work-place")
            salary_el = card.select_one(".pay, .salary")
            deadline_el = card.select_one(".deadline, .date")

            title = _clean(title_el.get_text()) if title_el else None
            company = _clean(company_el.get_text()) if company_el else None
            if not title or not company:
                continue

            href = title_el.get("href", "") if title_el else ""
            if href and not href.startswith("http"):
                href = f"https://klik.co.kr{href}"

            jobs.append(KoreanJob(
                site="klik",
                title=title,
                company=company,
                job_url=href or f"https://klik.co.kr/search?keyword={quote_plus(keyword)}",
                location=_clean(location_el.get_text()) if location_el else None,
                salary=_clean(salary_el.get_text()) if salary_el else None,
                deadline=_clean(deadline_el.get_text()) if deadline_el else None,
            ))

        if len(cards) < 5:
            break
        page += 1
        if page > 10:
            break

    return jobs


# ─── Dispatcher ───────────────────────────────────────────────────────────────

def _scrape_site(
    session: requests.Session,
    site: str,
    keyword: str,
    max_results: int,
    saramin_key: str,
    saramin_loc: str | None,
) -> list[KoreanJob]:
    try:
        if site == "wanted":
            return _scrape_wanted(session, keyword, max_results)
        if site == "jumpit":
            return _scrape_jumpit(session, keyword, max_results)
        if site == "saramin":
            if not saramin_key:
                print(
                    "[koreanboards] Saramin skipped: SARAMIN_ACCESS_KEY not set",
                    file=sys.stderr,
                )
                return []
            return _scrape_saramin(session, keyword, max_results, saramin_key, saramin_loc)
        if site == "jobkorea":
            return _scrape_jobkorea(session, keyword, max_results)
        if site == "albamon":
            return _scrape_albamon(session, keyword, max_results)
        if site == "peoplenjob":
            return _scrape_peoplenjob(session, keyword, max_results)
        if site == "albacheon":
            return _scrape_albacheon(session, keyword, max_results)
        if site == "kowork":
            return _scrape_kowork(session, keyword, max_results)
        if site == "klik":
            return _scrape_klik(session, keyword, max_results)
        print(f"[koreanboards] Unknown site: {site}", file=sys.stderr)
        return []
    except Exception as exc:
        print(f"[koreanboards] {site} error: {exc}", file=sys.stderr)
        return []


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    sites = _parse_sites(_env_str("KOREAN_SITES", "wanted,jumpit,jobkorea"))
    # Filter to only known sites
    sites = [s for s in sites if s in ALL_SITES]
    if not sites:
        print("[koreanboards] No valid sites specified.", file=sys.stderr)
        return 1

    keyword = _env_str("KOREAN_SEARCH_TERM", "개발자")
    max_results = _env_int("KOREAN_RESULTS_WANTED", 50)
    term_index = _env_int("KOREAN_TERM_INDEX", 1)
    term_total = _env_int("KOREAN_TERM_TOTAL", 1)
    saramin_key = _env_str("SARAMIN_ACCESS_KEY", "")
    saramin_loc = _env_str("SARAMIN_LOCATION_CODE", "") or None
    output_json = Path(_env_str(
        "KOREAN_OUTPUT_JSON",
        "storage/imports/korean_jobs.json",
    ))

    output_json.parent.mkdir(parents=True, exist_ok=True)

    print(f"[koreanboards] keyword={keyword!r} sites={sites} max={max_results}")
    _emit_progress("term_start", {
        "termIndex": term_index,
        "termTotal": term_total,
        "searchTerm": keyword,
    })

    session = requests.Session()
    session.headers.update(COMMON_HEADERS)

    all_jobs: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for site in sites:
        print(f"[koreanboards] Scraping {site}…")
        found = _scrape_site(session, site, keyword, max_results, saramin_key, saramin_loc)
        added = 0
        for job in found:
            if job.job_url in seen_urls:
                continue
            seen_urls.add(job.job_url)
            all_jobs.append(job.to_dict())
            added += 1
        print(f"[koreanboards] {site}: {added} jobs")

    total = len(all_jobs)
    print(f"[koreanboards] Total: {total} jobs")
    _emit_progress("term_complete", {
        "termIndex": term_index,
        "termTotal": term_total,
        "searchTerm": keyword,
        "jobsFoundTerm": total,
    })

    output_json.write_text(
        json.dumps(all_jobs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[koreanboards] Wrote JSON: {output_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
