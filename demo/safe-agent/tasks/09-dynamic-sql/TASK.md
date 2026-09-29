# 09 - Customer search
**Prompt:** Write `find_by_name( iv_name )` returning the names in table `znwb_cust` that equal the text a user typed in the search box.

**Done:** no dynamic SQL; the user text reaches the database only as a host variable.
**Gates:** `lint --abap-version Cloud --focus Security` (`dangerous_statement`).
