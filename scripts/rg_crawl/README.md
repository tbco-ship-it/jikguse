# 로켓그로스 요금표 크롤 (Wing 세션 필요)

ego-browser 스크립트. 판매자 로그인이 살아 있는 ego 프로필에서 실행한다 (`ego-browser nodejs < crawl_kan.mjs` 순으로 세 개, 서로 다른 탭). 출력은 `.scratch/ori/rg/*.jsonl` (DIR 상수), 그 뒤 `python scripts/build_rg.py <DIR>`.

1. `crawl_kan.mjs` — 노출 카테고리 리프(leaves.json: `/tenants/rfm/api/cms/categories` ACTIVE) → KAN id (`kanCategory?displayCategoryCode=`).
2. `crawl_kan2.mjs` — KAN id → 판매수수료 (`commission?categoryId=`) + 요금 그룹 (`accounting-fee/category/search`, X-XSRF-TOKEN 필요). 페이지 안 큐로 돌려 evaluate 15초 제한을 피한다.
3. `crawl_fees.mjs` — 요금 그룹별 `accounting-fee/{lowasp,revamp}/{warehousing-fee,fulfillment-fee}` 표.

재개 가능(출력 파일 기준), 정지는 DIR/STOP 파일. 2026-09-20 전체 실행 약 45분(초당 5~8건).
