# PROVENANCE

Real-world RAP behavior-definition (`.bdef.asbdef`) and service-definition (`.srvd.srvdsrv`) fixtures collected from public SAP / SAP-samples GitHub repositories for the offline BDEF/SRVD checker eval corpus (`evals/rap/fixtures/`).

Collected via `gh api "search/code?q=extension:asbdef+org:SAP-samples"` (and `extension:srvdsrv`, and `org:SAP`) on **2026-09-10**. Every candidate repository's licence was confirmed with `gh api repos/<owner>/<repo> --jq .license.spdx_id` before inclusion; only `Apache-2.0` (or `MIT`) repositories were kept — **all 17 repositories that surfaced in this search are Apache-2.0**, so nothing was excluded on licence grounds this pass.

Each BDEF/SRVD file was downloaded verbatim (`raw.githubusercontent.com`) at the **commit SHA that was the tip of the repository's default branch at fetch time** (not the — possibly older — commit the code-search index had last crawled), into `evals/rap/fixtures/<owner>__<repo>/<abapGit-filename>`. Where a BDEF's own directory also contained one or more companion `.ddls.asddls` CDS view definitions, those were fetched alongside it (same directory, same commit) so the checker can cross-check the entity names a BDEF's `define behavior for …` clauses reference.

## Totals

- **79** `.bdef.asbdef` behavior definitions
- **23** `.srvd.srvdsrv` service definitions
- **141** companion `.ddls.asddls` CDS view definitions (context, not scored directly)
- **17** source repositories, all `Apache-2.0`

## Repositories

| Repository | Licence | Default branch | Commit SHA (fetch time) | BDEF | SRVD | DDLS |
|---|---|---|---|---:|---:|---:|
| [SAP-samples/abap-cheat-sheets](https://github.com/SAP-samples/abap-cheat-sheets) | Apache-2.0 | `main` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | 4 | 1 | 16 |
| [SAP-samples/abap-platform-application-jobs](https://github.com/SAP-samples/abap-platform-application-jobs) | Apache-2.0 | `main` | `532f9466e3ddd28f85495a6c34cac2e637d1bf6a` | 2 | 1 | 4 |
| [SAP-samples/abap-platform-basic-trial](https://github.com/SAP-samples/abap-platform-basic-trial) | Apache-2.0 | `main` | `701a412ca7ec3716848b54358f277ef259a4dcbc` | 2 | 1 | 2 |
| [SAP-samples/abap-platform-bgpf-appl-log-events-side-effects](https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects) | Apache-2.0 | `main` | `94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe` | 3 | 1 | 4 |
| [SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf](https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf) | Apache-2.0 | `main` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | 4 | 2 | 6 |
| [SAP-samples/abap-platform-rap-workshops](https://github.com/SAP-samples/abap-platform-rap-workshops) | Apache-2.0 | `main` | `c7abb9db86a7c2153253062d6f57781948933ec8` | 6 | 3 | 8 |
| [SAP-samples/abap-platform-rap100](https://github.com/SAP-samples/abap-platform-rap100) | Apache-2.0 | `main` | `0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1` | 2 | 1 | 3 |
| [SAP-samples/abap-platform-rap110](https://github.com/SAP-samples/abap-platform-rap110) | Apache-2.0 | `main` | `8fb9d7ba474d3702f9b9db4ca05a2227c66a200e` | 2 | 1 | 7 |
| [SAP-samples/abap-platform-rap630](https://github.com/SAP-samples/abap-platform-rap630) | Apache-2.0 | `main` | `07089f8f33c7aa1284f562e23a71b29d849e6e26` | 3 | 1 | 6 |
| [SAP-samples/abap-platform-rap630-ext](https://github.com/SAP-samples/abap-platform-rap630-ext) | Apache-2.0 | `main` | `2b6eaf8b6df824545f768f8b6063853abfae6632` | 2 | 0 | 6 |
| [SAP-samples/abap-platform-reuse-services](https://github.com/SAP-samples/abap-platform-reuse-services) | Apache-2.0 | `main` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | 3 | 2 | 15 |
| [SAP-samples/btp-abap-cna](https://github.com/SAP-samples/btp-abap-cna) | Apache-2.0 | `main` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | 36 | 4 | 41 |
| [SAP-samples/forms-service-by-adobe-samples](https://github.com/SAP-samples/forms-service-by-adobe-samples) | Apache-2.0 | `main` | `8ca8f207f3be19f0cd405787ffc1a022a60d9820` | 1 | 2 | 2 |
| [SAP-samples/teched2025-AD163](https://github.com/SAP-samples/teched2025-AD163) | Apache-2.0 | `main` | `e6cbd638609074ce6539108937675c55dc93a7ed` | 2 | 1 | 4 |
| [SAP-samples/teched2025-DT266](https://github.com/SAP-samples/teched2025-DT266) | Apache-2.0 | `main` | `f1db4a3f047ea8b96a623bbf599d7839d4e75cf9` | 3 | 1 | 6 |
| [SAP/code-pal-for-abap-cloud](https://github.com/SAP/code-pal-for-abap-cloud) | Apache-2.0 | `main` | `f5ba92511b0997caca90399c77403596815968b0` | 1 | 0 | 1 |
| [SAP/project-kernseife](https://github.com/SAP/project-kernseife) | Apache-2.0 | `main` | `c4ceb95077707684cfbe6c13a37f87f3a942448f` | 3 | 1 | 10 |

## File-level provenance — BDEF and SRVD fixtures

| Repo | Path (in repo) | Commit SHA | Licence | URL |
|---|---|---|---|---|
| SAP-samples/abap-cheat-sheets | `src/zdemo_abap_rap_calc_sd.srvd.srvdsrv` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | Apache-2.0 | <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_calc_sd.srvd.srvdsrv> |
| SAP-samples/abap-cheat-sheets | `src/zdemo_abap_rap_draft_m.bdef.asbdef` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | Apache-2.0 | <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_draft_m.bdef.asbdef> |
| SAP-samples/abap-cheat-sheets | `src/zdemo_abap_rap_ro_m.bdef.asbdef` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | Apache-2.0 | <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_m.bdef.asbdef> |
| SAP-samples/abap-cheat-sheets | `src/zdemo_abap_rap_ro_m_as.bdef.asbdef` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | Apache-2.0 | <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_m_as.bdef.asbdef> |
| SAP-samples/abap-cheat-sheets | `src/zdemo_abap_rap_ro_u.bdef.asbdef` | `ec37299191893e3572085d2f9b6ccf6865aa1f98` | Apache-2.0 | <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_u.bdef.asbdef> |
| SAP-samples/abap-platform-application-jobs | `src/zappc_inventorytp_01.bdef.asbdef` | `532f9466e3ddd28f85495a6c34cac2e637d1bf6a` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappc_inventorytp_01.bdef.asbdef> |
| SAP-samples/abap-platform-application-jobs | `src/zappinventory_01.srvd.srvdsrv` | `532f9466e3ddd28f85495a6c34cac2e637d1bf6a` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappinventory_01.srvd.srvdsrv> |
| SAP-samples/abap-platform-application-jobs | `src/zappr_inventorytp_01.bdef.asbdef` | `532f9466e3ddd28f85495a6c34cac2e637d1bf6a` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappr_inventorytp_01.bdef.asbdef> |
| SAP-samples/abap-platform-basic-trial | `src/zac000000uxx/zc_ac000000uxx.bdef.asbdef` | `701a412ca7ec3716848b54358f277ef259a4dcbc` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-basic-trial/blob/701a412ca7ec3716848b54358f277ef259a4dcbc/src/zac000000uxx/zc_ac000000uxx.bdef.asbdef> |
| SAP-samples/abap-platform-basic-trial | `src/zac000000uxx/zr_ac000000uxx.bdef.asbdef` | `701a412ca7ec3716848b54358f277ef259a4dcbc` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-basic-trial/blob/701a412ca7ec3716848b54358f277ef259a4dcbc/src/zac000000uxx/zr_ac000000uxx.bdef.asbdef> |
| SAP-samples/abap-platform-basic-trial | `src/zac000000uxx/zui_ac000000uxx_o4.srvd.srvdsrv` | `701a412ca7ec3716848b54358f277ef259a4dcbc` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-basic-trial/blob/701a412ca7ec3716848b54358f277ef259a4dcbc/src/zac000000uxx/zui_ac000000uxx_o4.srvd.srvdsrv> |
| SAP-samples/abap-platform-bgpf-appl-log-events-side-effects | `src/zbgpfc_inventorytp_006.bdef.asbdef` | `94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfc_inventorytp_006.bdef.asbdef> |
| SAP-samples/abap-platform-bgpf-appl-log-events-side-effects | `src/zbgpfi_inventorytp_006.bdef.asbdef` | `94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfi_inventorytp_006.bdef.asbdef> |
| SAP-samples/abap-platform-bgpf-appl-log-events-side-effects | `src/zbgpfr_inventorytp_006.bdef.asbdef` | `94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfr_inventorytp_006.bdef.asbdef> |
| SAP-samples/abap-platform-bgpf-appl-log-events-side-effects | `src/zbgpfui_inventory_006.srvd.srvdsrv` | `94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfui_inventory_006.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zc_order000.bdef.asbdef` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zc_order000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zfel_rap_bgpf_shipping/zc_shippingrequest.bdef.asbdef` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zfel_rap_bgpf_shipping/zc_shippingrequest.bdef.asbdef> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zfel_rap_bgpf_shipping/zr_shippingrequest.bdef.asbdef` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zfel_rap_bgpf_shipping/zr_shippingrequest.bdef.asbdef> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zfel_rap_bgpf_shipping/zshippingrequest_service.srvd.srvdsrv` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zfel_rap_bgpf_shipping/zshippingrequest_service.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zorder_service.srvd.srvdsrv` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zorder_service.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf | `src/zr_order000.bdef.asbdef` | `8cd3f64340db119e1e8ae0c30e0da650c584fd9c` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zr_order000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/z_online_shop_mcrsft1/zc_onlineshop_ms1.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zc_onlineshop_ms1.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/z_online_shop_mcrsft1/zr_onlineshop_ms1.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zr_onlineshop_ms1.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/z_online_shop_mcrsft1/zui_onlineshop_ms1.srvd.srvdsrv` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zui_onlineshop_ms1.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap-workshops | `src/z_onlineshop_000/zc_onlineshop_000.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_onlineshop_000/zc_onlineshop_000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/z_onlineshop_000/zr_onlineshop_000.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_onlineshop_000/zr_onlineshop_000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/z_onlineshop_000/zui_onlineshop_000.srvd.srvdsrv` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_onlineshop_000/zui_onlineshop_000.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap-workshops | `src/zrap100_000/zrap100_c_traveltp_000.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/zrap100_000/zrap100_c_traveltp_000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/zrap100_000/zrap100_r_traveltp_000.bdef.asbdef` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/zrap100_000/zrap100_r_traveltp_000.bdef.asbdef> |
| SAP-samples/abap-platform-rap-workshops | `src/zrap100_000/zrap100_ui_traveltp_000.srvd.srvdsrv` | `c7abb9db86a7c2153253062d6f57781948933ec8` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/zrap100_000/zrap100_ui_traveltp_000.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap100 | `src/zrap100_c_traveltp_sol.bdef.asbdef` | `0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_c_traveltp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap100 | `src/zrap100_r_traveltp_sol.bdef.asbdef` | `0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_r_traveltp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap100 | `src/zrap100_ui_travel_sol.srvd.srvdsrv` | `0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_ui_travel_sol.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap110 | `src/zrap110_c_traveltp_sol.bdef.asbdef` | `8fb9d7ba474d3702f9b9db4ca05a2227c66a200e` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_c_traveltp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap110 | `src/zrap110_r_traveltp_sol.bdef.asbdef` | `8fb9d7ba474d3702f9b9db4ca05a2227c66a200e` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_r_traveltp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap110 | `src/zrap110_ui_travel_sol.srvd.srvdsrv` | `8fb9d7ba474d3702f9b9db4ca05a2227c66a200e` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_ui_travel_sol.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap630 | `src/zrap630c_shoptp_sol.bdef.asbdef` | `07089f8f33c7aa1284f562e23a71b29d849e6e26` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630c_shoptp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap630 | `src/zrap630i_shoptp_sol.bdef.asbdef` | `07089f8f33c7aa1284f562e23a71b29d849e6e26` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630i_shoptp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap630 | `src/zrap630r_shoptp_sol.bdef.asbdef` | `07089f8f33c7aa1284f562e23a71b29d849e6e26` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630r_shoptp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-rap630 | `src/zrap630ui_shop_sol.srvd.srvdsrv` | `07089f8f33c7aa1284f562e23a71b29d849e6e26` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630ui_shop_sol.srvd.srvdsrv> |
| SAP-samples/abap-platform-rap630-ext | `src/zrap630c_ext_shoptp_ext.bdef.asbdef` | `2b6eaf8b6df824545f768f8b6063853abfae6632` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630c_ext_shoptp_ext.bdef.asbdef> |
| SAP-samples/abap-platform-rap630-ext | `src/zrap630r_ext_shoptp_sol.bdef.asbdef` | `2b6eaf8b6df824545f768f8b6063853abfae6632` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630r_ext_shoptp_sol.bdef.asbdef> |
| SAP-samples/abap-platform-reuse-services | `src/zreusec_salesordertp_002.bdef.asbdef` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusec_salesordertp_002.bdef.asbdef> |
| SAP-samples/abap-platform-reuse-services | `src/zreusei_salesordertp_002.bdef.asbdef` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_salesordertp_002.bdef.asbdef> |
| SAP-samples/abap-platform-reuse-services | `src/zreuser_salesordertp_002.bdef.asbdef` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreuser_salesordertp_002.bdef.asbdef> |
| SAP-samples/abap-platform-reuse-services | `src/zreuseui_salesorder_002.srvd.srvdsrv` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreuseui_salesorder_002.srvd.srvdsrv> |
| SAP-samples/abap-platform-reuse-services | `src/zreuseui_salesorder_002_ads.srvd.srvdsrv` | `b2c3d5800fcab3f10f492c533b1615545033baa5` | Apache-2.0 | <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreuseui_salesorder_002_ads.srvd.srvdsrv> |
| SAP-samples/btp-abap-cna | `src/z_businesspartner_sa.srvd.srvdsrv` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/z_businesspartner_sa.srvd.srvdsrv> |
| SAP-samples/btp-abap-cna | `src/z_salesorderitemcube_sa.srvd.srvdsrv` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/z_salesorderitemcube_sa.srvd.srvdsrv> |
| SAP-samples/btp-abap-cna | `src/z_sd_bonus_calculation_sa.srvd.srvdsrv` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/z_sd_bonus_calculation_sa.srvd.srvdsrv> |
| SAP-samples/btp-abap-cna | `src/za_addressemailaddress.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressemailaddress.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_addressfaxnumber.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressfaxnumber.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_addresshomepageurl.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addresshomepageurl.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_addressphonenumber.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressphonenumber.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_bpcontacttofuncanddept.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bpcontacttofuncanddept.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_bupaaddressusage.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaaddressusage.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_bupaidentification.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaidentification.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_bupaindustry.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaindustry.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartner.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartner.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartneraddress.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartneraddress.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartnerbank.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnerbank.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartnercontact.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnercontact.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartnerrole.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnerrole.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_businesspartnertaxnumber.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnertaxnumber.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customer.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customer.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customercompany.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customercompany.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customercompanytext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customercompanytext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customerdunning.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerdunning.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customersalesarea.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesarea.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customersalesareatax.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesareatax.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customersalesareatext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesareatext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customertaxgrouping.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customertaxgrouping.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customertext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customertext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customerunloadingpoint.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerunloadingpoint.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_customerwithholdingtax.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerwithholdingtax.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_custsalespartnerfunc.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_custsalespartnerfunc.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplier.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplier.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_suppliercompany.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliercompany.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_suppliercompanytext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliercompanytext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplierdunning.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierdunning.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplierpartnerfunc.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpartnerfunc.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplierpurchasingorg.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpurchasingorg.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplierpurchasingorgtext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpurchasingorgtext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_suppliertext.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliertext.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/za_supplierwithholdingtax.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierwithholdingtax.bdef.asbdef> |
| SAP-samples/btp-abap-cna | `src/zapi_ce_bonus_calc_sa.srvd.srvdsrv` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zapi_ce_bonus_calc_sa.srvd.srvdsrv> |
| SAP-samples/btp-abap-cna | `src/zi_bonus_calc_sa.bdef.asbdef` | `c45b86aa6ae2a8910b5d0dc48d1e41b94c896868` | Apache-2.0 | <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zi_bonus_calc_sa.bdef.asbdef> |
| SAP-samples/forms-service-by-adobe-samples | `abap/zfdp_scratch/zfdp_scratch_srvd.srvd.srvdsrv` | `8ca8f207f3be19f0cd405787ffc1a022a60d9820` | Apache-2.0 | <https://github.com/SAP-samples/forms-service-by-adobe-samples/blob/8ca8f207f3be19f0cd405787ffc1a022a60d9820/abap/zfdp_scratch/zfdp_scratch_srvd.srvd.srvdsrv> |
| SAP-samples/forms-service-by-adobe-samples | `abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_i_ticket.bdef.asbdef` | `8ca8f207f3be19f0cd405787ffc1a022a60d9820` | Apache-2.0 | <https://github.com/SAP-samples/forms-service-by-adobe-samples/blob/8ca8f207f3be19f0cd405787ffc1a022a60d9820/abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_i_ticket.bdef.asbdef> |
| SAP-samples/forms-service-by-adobe-samples | `abap/zfoba_cinema_demo/zfoba_cinema_fdp/zcine_ticket_srvd.srvd.srvdsrv` | `8ca8f207f3be19f0cd405787ffc1a022a60d9820` | Apache-2.0 | <https://github.com/SAP-samples/forms-service-by-adobe-samples/blob/8ca8f207f3be19f0cd405787ffc1a022a60d9820/abap/zfoba_cinema_demo/zfoba_cinema_fdp/zcine_ticket_srvd.srvd.srvdsrv> |
| SAP-samples/teched2025-AD163 | `src/zad163_z01/zz01c_cartprojection.bdef.asbdef` | `e6cbd638609074ce6539108937675c55dc93a7ed` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01c_cartprojection.bdef.asbdef> |
| SAP-samples/teched2025-AD163 | `src/zad163_z01/zz01r_cart.bdef.asbdef` | `e6cbd638609074ce6539108937675c55dc93a7ed` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01r_cart.bdef.asbdef> |
| SAP-samples/teched2025-AD163 | `src/zad163_z01/zz01ui_cartservice_o4.srvd.srvdsrv` | `e6cbd638609074ce6539108937675c55dc93a7ed` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01ui_cartservice_o4.srvd.srvdsrv> |
| SAP-samples/teched2025-DT266 | `src/zc_dt266_carr_000.bdef.asbdef` | `f1db4a3f047ea8b96a623bbf599d7839d4e75cf9` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zc_dt266_carr_000.bdef.asbdef> |
| SAP-samples/teched2025-DT266 | `src/zr_dt266_carr_000.bdef.asbdef` | `f1db4a3f047ea8b96a623bbf599d7839d4e75cf9` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zr_dt266_carr_000.bdef.asbdef> |
| SAP-samples/teched2025-DT266 | `src/zr_dt266_carr_000_e.bdef.asbdef` | `f1db4a3f047ea8b96a623bbf599d7839d4e75cf9` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zr_dt266_carr_000_e.bdef.asbdef> |
| SAP-samples/teched2025-DT266 | `src/zui_dt266_carr_000_o4.srvd.srvdsrv` | `f1db4a3f047ea8b96a623bbf599d7839d4e75cf9` | Apache-2.0 | <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zui_dt266_carr_000_o4.srvd.srvdsrv> |
| SAP/code-pal-for-abap-cloud | `src/test_objects/#cc4a#test_rap_unamanaged.bdef.asbdef` | `f5ba92511b0997caca90399c77403596815968b0` | Apache-2.0 | <https://github.com/SAP/code-pal-for-abap-cloud/blob/f5ba92511b0997caca90399c77403596815968b0/src/test_objects/#cc4a#test_rap_unamanaged.bdef.asbdef> |
| SAP/project-kernseife | `abap/btp/zknsf_btp_connector.srvd.srvdsrv` | `c4ceb95077707684cfbe6c13a37f87f3a942448f` | Apache-2.0 | <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_btp_connector.srvd.srvdsrv> |
| SAP/project-kernseife | `abap/btp/zknsf_i_file_stream.bdef.asbdef` | `c4ceb95077707684cfbe6c13a37f87f3a942448f` | Apache-2.0 | <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_file_stream.bdef.asbdef> |
| SAP/project-kernseife | `abap/btp/zknsf_i_file_upload.bdef.asbdef` | `c4ceb95077707684cfbe6c13a37f87f3a942448f` | Apache-2.0 | <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_file_upload.bdef.asbdef> |
| SAP/project-kernseife | `abap/btp/zknsf_i_projects.bdef.asbdef` | `c4ceb95077707684cfbe6c13a37f87f3a942448f` | Apache-2.0 | <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_projects.bdef.asbdef> |

## File-level provenance — companion DDLS fixtures

Grouped by repository (all fetched at the same commit SHA as that repository's row above).

**SAP-samples/abap-cheat-sheets** (`ec37299191893e3572085d2f9b6ccf6865aa1f98`)

- `src/zdemo_abap_abstract_ent.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_abstract_ent.ddls.asddls>
- `src/zdemo_abap_carr_ve.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_carr_ve.ddls.asddls>
- `src/zdemo_abap_cds_ve_agg_exp.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_cds_ve_agg_exp.ddls.asddls>
- `src/zdemo_abap_cds_ve_assoc.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_cds_ve_assoc.ddls.asddls>
- `src/zdemo_abap_cds_ve_assoc_e.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_cds_ve_assoc_e.ddls.asddls>
- `src/zdemo_abap_cds_ve_joins.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_cds_ve_joins.ddls.asddls>
- `src/zdemo_abap_cds_ve_sel.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_cds_ve_sel.ddls.asddls>
- `src/zdemo_abap_fli_ve.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_fli_ve.ddls.asddls>
- `src/zdemo_abap_flsch_ve.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_flsch_ve.ddls.asddls>
- `src/zdemo_abap_rap_ch_m.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ch_m.ddls.asddls>
- `src/zdemo_abap_rap_ch_u.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ch_u.ddls.asddls>
- `src/zdemo_abap_rap_draft_m.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_draft_m.ddls.asddls>
- `src/zdemo_abap_rap_ro_m.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_m.ddls.asddls>
- `src/zdemo_abap_rap_ro_m_as.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_m_as.ddls.asddls>
- `src/zdemo_abap_rap_ro_u.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_rap_ro_u.ddls.asddls>
- `src/zdemo_abap_table_function.ddls.asddls` — <https://github.com/SAP-samples/abap-cheat-sheets/blob/ec37299191893e3572085d2f9b6ccf6865aa1f98/src/zdemo_abap_table_function.ddls.asddls>

**SAP-samples/abap-platform-application-jobs** (`532f9466e3ddd28f85495a6c34cac2e637d1bf6a`)

- `src/zappc_inventorytp_01.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappc_inventorytp_01.ddls.asddls>
- `src/zappi_appl_log.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappi_appl_log.ddls.asddls>
- `src/zappi_inventorytp_01.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappi_inventorytp_01.ddls.asddls>
- `src/zappr_inventorytp_01.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-application-jobs/blob/532f9466e3ddd28f85495a6c34cac2e637d1bf6a/src/zappr_inventorytp_01.ddls.asddls>

**SAP-samples/abap-platform-basic-trial** (`701a412ca7ec3716848b54358f277ef259a4dcbc`)

- `src/zac000000uxx/zc_ac000000uxx.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-basic-trial/blob/701a412ca7ec3716848b54358f277ef259a4dcbc/src/zac000000uxx/zc_ac000000uxx.ddls.asddls>
- `src/zac000000uxx/zr_ac000000uxx.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-basic-trial/blob/701a412ca7ec3716848b54358f277ef259a4dcbc/src/zac000000uxx/zr_ac000000uxx.ddls.asddls>

**SAP-samples/abap-platform-bgpf-appl-log-events-side-effects** (`94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe`)

- `src/zbgpfc_inventorytp_006.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfc_inventorytp_006.ddls.asddls>
- `src/zbgpfi_inventory_006.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfi_inventory_006.ddls.asddls>
- `src/zbgpfi_inventorytp_006.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfi_inventorytp_006.ddls.asddls>
- `src/zbgpfr_inventorytp_006.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-bgpf-appl-log-events-side-effects/blob/94bc553d5c0494c4dcc4775a8dfb16a4a1929fbe/src/zbgpfr_inventorytp_006.ddls.asddls>

**SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf** (`8cd3f64340db119e1e8ae0c30e0da650c584fd9c`)

- `src/zc_order000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zc_order000.ddls.asddls>
- `src/zc_orderitem.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zc_orderitem.ddls.asddls>
- `src/zfel_rap_bgpf_shipping/zc_shippingrequest.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zfel_rap_bgpf_shipping/zc_shippingrequest.ddls.asddls>
- `src/zfel_rap_bgpf_shipping/zr_shippingrequest.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zfel_rap_bgpf_shipping/zr_shippingrequest.ddls.asddls>
- `src/zr_order000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zr_order000.ddls.asddls>
- `src/zr_orderitem.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-transactional-outbox-with-bgpf/blob/8cd3f64340db119e1e8ae0c30e0da650c584fd9c/src/zr_orderitem.ddls.asddls>

**SAP-samples/abap-platform-rap-workshops** (`c7abb9db86a7c2153253062d6f57781948933ec8`)

- `src/z_online_shop_mcrsft1/zabs_purchaserequisition.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zabs_purchaserequisition.ddls.asddls>
- `src/z_online_shop_mcrsft1/zc_onlineshop_ms1.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zc_onlineshop_ms1.ddls.asddls>
- `src/z_online_shop_mcrsft1/zi_items.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zi_items.ddls.asddls>
- `src/z_online_shop_mcrsft1/zr_onlineshop_ms1.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_online_shop_mcrsft1/zr_onlineshop_ms1.ddls.asddls>
- `src/z_onlineshop_000/zc_onlineshop_000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_onlineshop_000/zc_onlineshop_000.ddls.asddls>
- `src/z_onlineshop_000/zr_onlineshop_000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/z_onlineshop_000/zr_onlineshop_000.ddls.asddls>
- `src/zrap100_000/zrap100_c_traveltp_000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/zrap100_000/zrap100_c_traveltp_000.ddls.asddls>
- `src/zrap100_000/zrap100_r_traveltp_000.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap-workshops/blob/c7abb9db86a7c2153253062d6f57781948933ec8/src/zrap100_000/zrap100_r_traveltp_000.ddls.asddls>

**SAP-samples/abap-platform-rap100** (`0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1`)

- `src/zrap100_a_travel_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_a_travel_sol.ddls.asddls>
- `src/zrap100_c_traveltp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_c_traveltp_sol.ddls.asddls>
- `src/zrap100_r_traveltp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap100/blob/0c84e7e44b7c024fbc129ca6d7401aef1ea1d0b1/src/zrap100_r_traveltp_sol.ddls.asddls>

**SAP-samples/abap-platform-rap110** (`8fb9d7ba474d3702f9b9db4ca05a2227c66a200e`)

- `src/zrap110_a_create_travel_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_a_create_travel_sol.ddls.asddls>
- `src/zrap110_a_daystoflight_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_a_daystoflight_sol.ddls.asddls>
- `src/zrap110_a_travel_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_a_travel_sol.ddls.asddls>
- `src/zrap110_c_bookingtp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_c_bookingtp_sol.ddls.asddls>
- `src/zrap110_c_traveltp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_c_traveltp_sol.ddls.asddls>
- `src/zrap110_r_bookingtp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_r_bookingtp_sol.ddls.asddls>
- `src/zrap110_r_traveltp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap110/blob/8fb9d7ba474d3702f9b9db4ca05a2227c66a200e/src/zrap110_r_traveltp_sol.ddls.asddls>

**SAP-samples/abap-platform-rap630** (`07089f8f33c7aa1284f562e23a71b29d849e6e26`)

- `src/zrap630c_shoptp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630c_shoptp_sol.ddls.asddls>
- `src/zrap630e_shop_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630e_shop_sol.ddls.asddls>
- `src/zrap630i_shoptp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630i_shoptp_sol.ddls.asddls>
- `src/zrap630i_vh_product_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630i_vh_product_sol.ddls.asddls>
- `src/zrap630r_shop_d_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630r_shop_d_sol.ddls.asddls>
- `src/zrap630r_shoptp_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630/blob/07089f8f33c7aa1284f562e23a71b29d849e6e26/src/zrap630r_shoptp_sol.ddls.asddls>

**SAP-samples/abap-platform-rap630-ext** (`2b6eaf8b6df824545f768f8b6063853abfae6632`)

- `src/zrap630_a_feedback_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630_a_feedback_sol.ddls.asddls>
- `src/zrap630c_ext_shop_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630c_ext_shop_sol.ddls.asddls>
- `src/zrap630e_ext_shop_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630e_ext_shop_sol.ddls.asddls>
- `src/zrap630i_ext_shop_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630i_ext_shop_sol.ddls.asddls>
- `src/zrap630r_ext_shop_d_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630r_ext_shop_d_sol.ddls.asddls>
- `src/zrap630r_ext_shop_sol.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-rap630-ext/blob/2b6eaf8b6df824545f768f8b6063853abfae6632/src/zrap630r_ext_shop_sol.ddls.asddls>

**SAP-samples/abap-platform-reuse-services** (`b2c3d5800fcab3f10f492c533b1615545033baa5`)

- `src/zreusec_itemtp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusec_itemtp_002.ddls.asddls>
- `src/zreusec_itemtp_002_ads.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusec_itemtp_002_ads.ddls.asddls>
- `src/zreusec_salesordertp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusec_salesordertp_002.ddls.asddls>
- `src/zreusec_salesordertp_002_ads.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusec_salesordertp_002_ads.ddls.asddls>
- `src/zreusei_cdredadd_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_cdredadd_002.ddls.asddls>
- `src/zreusei_item_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_item_002.ddls.asddls>
- `src/zreusei_item_002_ads.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_item_002_ads.ddls.asddls>
- `src/zreusei_itemtp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_itemtp_002.ddls.asddls>
- `src/zreusei_salesorder01_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_salesorder01_002.ddls.asddls>
- `src/zreusei_salesorder_002_ads.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_salesorder_002_ads.ddls.asddls>
- `src/zreusei_salesordertp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_salesordertp_002.ddls.asddls>
- `src/zreusei_vh_customer_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_vh_customer_002.ddls.asddls>
- `src/zreusei_vh_product_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreusei_vh_product_002.ddls.asddls>
- `src/zreuser_itemtp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreuser_itemtp_002.ddls.asddls>
- `src/zreuser_salesordertp_002.ddls.asddls` — <https://github.com/SAP-samples/abap-platform-reuse-services/blob/b2c3d5800fcab3f10f492c533b1615545033baa5/src/zreuser_salesordertp_002.ddls.asddls>

**SAP-samples/btp-abap-cna** (`c45b86aa6ae2a8910b5d0dc48d1e41b94c896868`)

- `src/za_addressemailaddress.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressemailaddress.ddls.asddls>
- `src/za_addressfaxnumber.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressfaxnumber.ddls.asddls>
- `src/za_addresshomepageurl.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addresshomepageurl.ddls.asddls>
- `src/za_addressphonenumber.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_addressphonenumber.ddls.asddls>
- `src/za_bpcontacttoaddress.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bpcontacttoaddress.ddls.asddls>
- `src/za_bpcontacttofuncanddept.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bpcontacttofuncanddept.ddls.asddls>
- `src/za_bupaaddressusage.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaaddressusage.ddls.asddls>
- `src/za_bupaidentification.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaidentification.ddls.asddls>
- `src/za_bupaindustry.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_bupaindustry.ddls.asddls>
- `src/za_businesspartner.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartner.ddls.asddls>
- `src/za_businesspartneraddress.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartneraddress.ddls.asddls>
- `src/za_businesspartnerbank.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnerbank.ddls.asddls>
- `src/za_businesspartnercontact.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnercontact.ddls.asddls>
- `src/za_businesspartnerrole.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnerrole.ddls.asddls>
- `src/za_businesspartnertaxnumber.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_businesspartnertaxnumber.ddls.asddls>
- `src/za_customer.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customer.ddls.asddls>
- `src/za_customercompany.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customercompany.ddls.asddls>
- `src/za_customercompanytext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customercompanytext.ddls.asddls>
- `src/za_customerdunning.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerdunning.ddls.asddls>
- `src/za_customersalesarea.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesarea.ddls.asddls>
- `src/za_customersalesareatax.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesareatax.ddls.asddls>
- `src/za_customersalesareatext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customersalesareatext.ddls.asddls>
- `src/za_customertaxgrouping.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customertaxgrouping.ddls.asddls>
- `src/za_customertext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customertext.ddls.asddls>
- `src/za_customerunloadingpoint.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerunloadingpoint.ddls.asddls>
- `src/za_customerwithholdingtax.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_customerwithholdingtax.ddls.asddls>
- `src/za_custsalespartnerfunc.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_custsalespartnerfunc.ddls.asddls>
- `src/za_supplier.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplier.ddls.asddls>
- `src/za_suppliercompany.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliercompany.ddls.asddls>
- `src/za_suppliercompanytext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliercompanytext.ddls.asddls>
- `src/za_supplierdunning.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierdunning.ddls.asddls>
- `src/za_supplierpartnerfunc.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpartnerfunc.ddls.asddls>
- `src/za_supplierpurchasingorg.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpurchasingorg.ddls.asddls>
- `src/za_supplierpurchasingorgtext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierpurchasingorgtext.ddls.asddls>
- `src/za_suppliertext.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_suppliertext.ddls.asddls>
- `src/za_supplierwithholdingtax.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/za_supplierwithholdingtax.ddls.asddls>
- `src/zi_bonus_calc_sa.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zi_bonus_calc_sa.ddls.asddls>
- `src/zi_bonus_release_status_sa.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zi_bonus_release_status_sa.ddls.asddls>
- `src/zi_ce_employee_sa.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zi_ce_employee_sa.ddls.asddls>
- `src/zyy1_salesorderitemcubesa.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zyy1_salesorderitemcubesa.ddls.asddls>
- `src/zyy1_salesorderitemcubesaresu.ddls.asddls` — <https://github.com/SAP-samples/btp-abap-cna/blob/c45b86aa6ae2a8910b5d0dc48d1e41b94c896868/src/zyy1_salesorderitemcubesaresu.ddls.asddls>

**SAP-samples/forms-service-by-adobe-samples** (`8ca8f207f3be19f0cd405787ffc1a022a60d9820`)

- `abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_ae_pdf_output.ddls.asddls` — <https://github.com/SAP-samples/forms-service-by-adobe-samples/blob/8ca8f207f3be19f0cd405787ffc1a022a60d9820/abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_ae_pdf_output.ddls.asddls>
- `abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_ae_pq_param.ddls.asddls` — <https://github.com/SAP-samples/forms-service-by-adobe-samples/blob/8ca8f207f3be19f0cd405787ffc1a022a60d9820/abap/zfoba_cinema_demo/zfoba_cinema_app/zcine_ae_pq_param.ddls.asddls>

**SAP-samples/teched2025-AD163** (`e6cbd638609074ce6539108937675c55dc93a7ed`)

- `src/zad163_z01/zz01c_cartprojection.ddls.asddls` — <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01c_cartprojection.ddls.asddls>
- `src/zad163_z01/zz01c_itemprojection.ddls.asddls` — <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01c_itemprojection.ddls.asddls>
- `src/zad163_z01/zz01r_cart.ddls.asddls` — <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01r_cart.ddls.asddls>
- `src/zad163_z01/zz01r_item.ddls.asddls` — <https://github.com/SAP-samples/teched2025-AD163/blob/e6cbd638609074ce6539108937675c55dc93a7ed/src/zad163_z01/zz01r_item.ddls.asddls>

**SAP-samples/teched2025-DT266** (`f1db4a3f047ea8b96a623bbf599d7839d4e75cf9`)

- `src/z_i_book_suppl.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/z_i_book_suppl.ddls.asddls>
- `src/z_i_price_000.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/z_i_price_000.ddls.asddls>
- `src/z_i_price_flight.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/z_i_price_flight.ddls.asddls>
- `src/z_i_suppl.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/z_i_suppl.ddls.asddls>
- `src/zc_dt266_carr_000.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zc_dt266_carr_000.ddls.asddls>
- `src/zr_dt266_carr_000.ddls.asddls` — <https://github.com/SAP-samples/teched2025-DT266/blob/f1db4a3f047ea8b96a623bbf599d7839d4e75cf9/src/zr_dt266_carr_000.ddls.asddls>

**SAP/code-pal-for-abap-cloud** (`f5ba92511b0997caca90399c77403596815968b0`)

- `src/test_objects/#cc4a#test_rap_unamanaged.ddls.asddls` — <https://github.com/SAP/code-pal-for-abap-cloud/blob/f5ba92511b0997caca90399c77403596815968b0/src/test_objects/#cc4a#test_rap_unamanaged.ddls.asddls>

**SAP/project-kernseife** (`c4ceb95077707684cfbe6c13a37f87f3a942448f`)

- `abap/btp/zknsf_i_development_objects.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_development_objects.ddls.asddls>
- `abap/btp/zknsf_i_exemptions.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_exemptions.ddls.asddls>
- `abap/btp/zknsf_i_file_stream.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_file_stream.ddls.asddls>
- `abap/btp/zknsf_i_file_upload.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_file_upload.ddls.asddls>
- `abap/btp/zknsf_i_finding_count.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_finding_count.ddls.asddls>
- `abap/btp/zknsf_i_findings.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_findings.ddls.asddls>
- `abap/btp/zknsf_i_metrics.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_metrics.ddls.asddls>
- `abap/btp/zknsf_i_object_count.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_object_count.ddls.asddls>
- `abap/btp/zknsf_i_projects.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_projects.ddls.asddls>
- `abap/btp/zknsf_i_run_state.ddls.asddls` — <https://github.com/SAP/project-kernseife/blob/c4ceb95077707684cfbe6c13a37f87f3a942448f/abap/btp/zknsf_i_run_state.ddls.asddls>

## Local layout

```
evals/rap/fixtures/
  <owner>__<repo>/
    <name>.bdef.asbdef        # behavior definition, abapGit filename kept as-is
    <name>.srvd.srvdsrv       # service definition
    <name>.ddls.asddls        # companion CDS view definition(s), if present alongside a BDEF
  PROVENANCE.md                # this file
```

## Licence texts

All 17 source repositories are licensed **Apache License, Version 2.0** (SPDX `Apache-2.0`). None of them carries a repository-level `NOTICE` file (`gh api repos/<owner>/<repo>/contents/NOTICE` → 404 for all 17, checked 2026-09-10), so per Apache-2.0 §4(d) there are no upstream attribution notices to reproduce beyond the standard licence grant. The required notice for this redistribution is reproduced once below and applies to every fixture file under `evals/rap/fixtures/*/`.

> Portions of this directory (the `*.bdef.asbdef`, `*.srvd.srvdsrv`, and `*.ddls.asddls` files under each `<owner>__<repo>/` subdirectory) are Copyright © SAP SE or an SAP affiliate company, taken unmodified from the repositories listed above, and are licensed under the Apache License, Version 2.0 (the "License"); you may not use these files except in compliance with the License. You may obtain a copy of the License at
>
>     http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

Full licence text for each repository: `https://github.com/<owner>/<repo>/blob/main/LICENSE` (or `LICENSE.txt`/`LICENSES/Apache-2.0.txt` — repos vary in filename but all resolve to the standard Apache-2.0 text; confirmed via `.license.spdx_id` above).

