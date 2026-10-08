-- Values remain integer cents throughout; rounding is presentation-only.
CREATE TABLE daily AS
SELECT CAST(occurred_at AS DATE)::VARCHAR AS date,
       SUM(booked_cents)::BIGINT AS booked_cents,
       SUM(captured_cents)::BIGINT AS captured_cents,
       SUM(refunded_cents)::BIGINT AS refunded_cents,
       SUM(captured_cents-refunded_cents)::BIGINT AS net_cents,
       COUNT(*)::BIGINT AS events
FROM postings GROUP BY 1 ORDER BY 1;

CREATE TABLE inventory AS
SELECT sku, SUM(quantity)::BIGINT AS on_hand
FROM movements GROUP BY sku ORDER BY sku;
