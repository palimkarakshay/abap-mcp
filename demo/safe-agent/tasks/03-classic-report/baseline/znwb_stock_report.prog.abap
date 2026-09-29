REPORT znwb_stock_report.
TABLES: mara.
DATA gv_cnt TYPE i.
DATA: BEGIN OF gt_mat OCCURS 0,
        matnr TYPE mara-matnr,
        mtart TYPE mara-mtart,
      END OF gt_mat.

EXEC SQL.
  SELECT COUNT(*) INTO :gv_cnt FROM mara
ENDEXEC.

SELECT * FROM mara INTO CORRESPONDING FIELDS OF TABLE gt_mat UP TO 50 ROWS.
LOOP AT gt_mat.
  WRITE: / gt_mat-matnr, gt_mat-mtart.
ENDLOOP.
