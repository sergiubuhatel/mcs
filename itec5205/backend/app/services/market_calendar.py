"""NYSE/Nasdaq trading calendar: weekends, market holidays and one-off closures.

No new close exists on these days, so the automatic import skips them, the
"up to date" cutoff steps back over them, and forecast dates jump them.

Regular holidays (NYSE Rule 7.2), computed for any year:
    New Year's Day, Martin Luther King Jr. Day (3rd Mon Jan), Washington's
    Birthday (3rd Mon Feb), Good Friday, Memorial Day (last Mon May),
    Juneteenth (Jun 19, since 2022), Independence Day (Jul 4),
    Labor Day (1st Mon Sep), Thanksgiving (4th Thu Nov), Christmas (Dec 25).
A holiday on a Saturday is observed the Friday before, on a Sunday the Monday
after -- except New Year's Day on a Saturday, which is not observed (the
exchange stays open on Friday Dec 31).

Good Friday is not a federal holiday but the exchanges close; Columbus Day
and Veterans Day are federal holidays but the exchanges stay open.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

# Unscheduled closures (national days of mourning, weather, 9/11).
SPECIAL_CLOSURES = frozenset({
    date(2001, 9, 11), date(2001, 9, 12), date(2001, 9, 13), date(2001, 9, 14),
    date(2004, 6, 11),                      # President Reagan
    date(2007, 1, 2),                       # President Ford
    date(2012, 10, 29), date(2012, 10, 30),  # Hurricane Sandy
    date(2018, 12, 5),                      # President G. H. W. Bush
    date(2025, 1, 9),                       # President Carter
})


def _easter(year: int) -> date:
    """Western (Gregorian) Easter Sunday: anonymous Gregorian algorithm."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The n-th `weekday` (Mon=0) of the month; n=-1 is the last one."""
    if n > 0:
        first = date(year, month, 1)
        return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    last = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _observed(day: date) -> date | None:
    if day.weekday() == 5:
        return day - timedelta(days=1)
    if day.weekday() == 6:
        return day + timedelta(days=1)
    return day


@lru_cache(maxsize=None)
def market_holidays(year: int) -> dict[date, str]:
    """{date: name} of the exchange holidays in `year` (observed dates)."""
    days: dict[date, str] = {}
    new_year = date(year, 1, 1)
    if new_year.weekday() != 5:  # Saturday: not observed on Friday Dec 31
        days[_observed(new_year)] = "New Year's Day"
    if year >= 1998:
        days[_nth_weekday(year, 1, 0, 3)] = "Martin Luther King Jr. Day"
    days[_nth_weekday(year, 2, 0, 3)] = "Washington's Birthday"
    days[_easter(year) - timedelta(days=2)] = "Good Friday"
    days[_nth_weekday(year, 5, 0, -1)] = "Memorial Day"
    if year >= 2022:
        days[_observed(date(year, 6, 19))] = "Juneteenth"
    days[_observed(date(year, 7, 4))] = "Independence Day"
    days[_nth_weekday(year, 9, 0, 1)] = "Labor Day"
    days[_nth_weekday(year, 11, 3, 4)] = "Thanksgiving Day"
    days[_observed(date(year, 12, 25))] = "Christmas Day"
    # Next year's New Year's Day on a Saturday is not moved into this year (see above).
    return days


def holiday_name(day: date) -> str | None:
    """Why the market is closed on a weekday, or None when it is open."""
    if day in SPECIAL_CLOSURES:
        return "Special closure"
    return market_holidays(day.year).get(day)


def is_trading_day(day: date) -> bool:
    """The exchange holds a regular session on this date."""
    return day.weekday() < 5 and holiday_name(day) is None


def previous_trading_day(day: date) -> date:
    """`day` itself if it is a trading day, else the last one before it."""
    while not is_trading_day(day):
        day -= timedelta(days=1)
    return day


def next_trading_days(after: date, count: int) -> list[date]:
    """The `count` trading days after `after` (exclusive)."""
    out, day = [], after
    while len(out) < count:
        day += timedelta(days=1)
        if is_trading_day(day):
            out.append(day)
    return out
