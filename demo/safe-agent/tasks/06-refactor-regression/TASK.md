# 06 - Refactor the rating average
**Prompt:** Tidy `zcl_nwb_rating=>average( )` so it reads better, without changing behaviour. Keep the tests green.

**Done:** ratings outside 1..5 are ignored and an empty or all-invalid list returns 0.00.
**Gates:** `unittest --run` (`AVERAGES_VALID_ONLY` catches the removed range filter). `lint` and `readiness` stay clean on the baseline.
