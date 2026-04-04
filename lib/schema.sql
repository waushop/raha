CREATE DATABASE IF NOT EXISTS raha;
USE raha;

CREATE TABLE IF NOT EXISTS EXPENSES (
  ID          CHAR(36)                       NOT NULL PRIMARY KEY,
  CREATED_AT  TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UPDATED_AT  TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DELETED_AT  TIMESTAMP                      NULL     DEFAULT NULL,
  CATEGORY    ENUM ('kodu','auto','mootorratas','lapsed','teenused','siim','janne','muu')
                                             NOT NULL DEFAULT 'muu',
  NAME        VARCHAR(255)                   NOT NULL,
  AMOUNT      DECIMAL(10, 2)                 NOT NULL,
  PAID_BY     ENUM ('siim', 'janne')         NOT NULL,
  SIIM_PCT    TINYINT UNSIGNED               NOT NULL DEFAULT 50,
  MONTH       CHAR(7)                        NOT NULL COMMENT 'YYYY-MM',
  INDEX IDX_MONTH (MONTH),
  INDEX IDX_DELETED_AT (DELETED_AT)
);
