-- One bounded control row: no input links, IP addresses, cookies or media.
CREATE TABLE tiktok_admission (
  id integer PRIMARY KEY CHECK (id = 1),
  lease text NOT NULL,
  active_until timestamptz NOT NULL,
  next_start timestamptz NOT NULL,
  day_start date NOT NULL,
  daily_count integer NOT NULL CHECK (daily_count > 0)
);
