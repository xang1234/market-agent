-- Core metrics registry.
-- unit_class in ('currency', 'percent', 'count', 'ratio', 'duration', 'enum')
-- aggregation in ('sum', 'avg', 'point_in_time', 'ttm', 'yoy', 'qoq', 'derived')
-- interpretation in ('higher_is_better', 'lower_is_better', 'neutral')
-- canonical_source_class in ('gaap', 'ifrs', 'vendor', 'market', 'derived')

insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class, definition_version, notes) values
  -- Income statement
  ('revenue',               'Revenue',                    'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Total net sales or revenue for the period.'),
  ('cost_of_revenue',       'Cost of Revenue',            'currency', 'sum',          'lower_is_better',  'gaap',    1, 'Direct costs attributable to goods or services sold.'),
  ('gross_profit',          'Gross Profit',               'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Revenue less cost of revenue.'),
  ('operating_expenses',    'Operating Expenses',         'currency', 'sum',          'lower_is_better',  'gaap',    1, 'Operating expenses excluding cost of revenue.'),
  ('operating_income',      'Operating Income',           'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Income from operations (revenue minus cost of revenue and opex).'),
  ('net_income',            'Net Income',                 'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Net income attributable to common shareholders.'),
  ('ebitda',                'EBITDA',                     'currency', 'derived',      'higher_is_better', 'derived', 1, 'Earnings before interest, taxes, depreciation, and amortization.'),
  ('eps_basic',             'EPS (Basic)',                'currency', 'derived',      'higher_is_better', 'gaap',    1, 'Net income per basic share.'),
  ('eps_diluted',           'EPS (Diluted)',              'currency', 'derived',      'higher_is_better', 'gaap',    1, 'Net income per diluted share.'),
  ('shares_outstanding_basic',   'Shares Outstanding (Basic)',   'count', 'avg',           'neutral',     'gaap',    1, 'Basic weighted-average shares outstanding.'),
  ('shares_outstanding_diluted', 'Shares Outstanding (Diluted)', 'count', 'avg',           'neutral',     'gaap',    1, 'Diluted weighted-average shares outstanding.'),
  ('ifrs.revenue',         'IFRS Revenue',              'currency', 'sum',          'higher_is_better', 'ifrs',    1, 'Revenue recognized under IFRS; kept distinct from GAAP revenue.'),
  ('ifrs.profit_loss',     'IFRS Profit/Loss',          'currency', 'sum',          'higher_is_better', 'ifrs',    1, 'Profit or loss for the period under IFRS; kept distinct from GAAP net income.'),
  ('ifrs.eps_basic',       'IFRS EPS (Basic)',          'currency', 'derived',      'higher_is_better', 'ifrs',    1, 'Basic earnings per share under IFRS.'),
  ('ifrs.eps_diluted',     'IFRS EPS (Diluted)',        'currency', 'derived',      'higher_is_better', 'ifrs',    1, 'Diluted earnings per share under IFRS.'),

  -- Balance sheet
  ('total_assets',          'Total Assets',               'currency', 'point_in_time', 'neutral',         'gaap',    1, 'Total assets at period end.'),
  ('total_liabilities',     'Total Liabilities',          'currency', 'point_in_time', 'lower_is_better', 'gaap',    1, 'Total liabilities at period end.'),
  ('total_equity',          'Total Equity',               'currency', 'point_in_time', 'higher_is_better','gaap',    1, 'Total shareholders equity at period end.'),
  ('cash_and_equivalents',  'Cash and Equivalents',       'currency', 'point_in_time', 'higher_is_better','gaap',    1, 'Cash and short-term investments at period end.'),
  ('total_debt',            'Total Debt',                 'currency', 'point_in_time', 'lower_is_better', 'gaap',    1, 'Short-term plus long-term interest-bearing debt.'),

  -- Cash flow
  ('operating_cash_flow',   'Operating Cash Flow',        'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Net cash from operating activities.'),
  ('capex',                 'Capital Expenditures',       'currency', 'sum',          'neutral',          'gaap',    1, 'Investments in property, plant, and equipment.'),
  ('free_cash_flow',        'Free Cash Flow',             'currency', 'derived',      'higher_is_better', 'derived', 1, 'Operating cash flow less capex.'),

  -- Margins
  ('gross_margin',          'Gross Margin',               'percent',  'derived',      'higher_is_better', 'derived', 1, 'Gross profit divided by revenue.'),
  ('operating_margin',      'Operating Margin',           'percent',  'derived',      'higher_is_better', 'derived', 1, 'Operating income divided by revenue.'),
  ('net_margin',            'Net Margin',                 'percent',  'derived',      'higher_is_better', 'derived', 1, 'Net income divided by revenue.'),
  ('ebitda_margin',         'EBITDA Margin',              'percent',  'derived',      'higher_is_better', 'derived', 1, 'EBITDA divided by revenue.'),

  -- Returns
  ('roe',                   'Return on Equity',           'percent',  'derived',      'higher_is_better', 'derived', 1, 'Net income divided by average shareholders equity.'),
  ('roa',                   'Return on Assets',           'percent',  'derived',      'higher_is_better', 'derived', 1, 'Net income divided by average total assets.'),
  ('roic',                  'Return on Invested Capital', 'percent',  'derived',      'higher_is_better', 'derived', 1, 'NOPAT divided by average invested capital.'),

  -- Liquidity and leverage
  ('current_ratio',         'Current Ratio',              'ratio',    'derived',      'higher_is_better', 'derived', 1, 'Current assets divided by current liabilities.'),
  ('quick_ratio',           'Quick Ratio',                'ratio',    'derived',      'higher_is_better', 'derived', 1, 'Liquid current assets divided by current liabilities.'),
  ('debt_to_equity',        'Debt / Equity',              'ratio',    'derived',      'lower_is_better',  'derived', 1, 'Total debt divided by total equity.'),
  ('debt_to_assets',        'Debt / Assets',              'ratio',    'derived',      'lower_is_better',  'derived', 1, 'Total debt divided by total assets.'),
  ('interest_coverage',     'Interest Coverage',          'ratio',    'derived',      'higher_is_better', 'derived', 1, 'Operating income divided by interest expense.'),

  -- Valuation multiples
  ('pe_ratio',              'Price / Earnings',           'ratio',    'derived',      'neutral',          'derived', 1, 'Price per share divided by trailing EPS (diluted).'),
  ('forward_pe_ratio',      'Forward Price / Earnings',   'ratio',    'derived',      'neutral',          'derived', 1, 'Price per share divided by forward consensus EPS.'),
  ('pb_ratio',              'Price / Book',               'ratio',    'derived',      'neutral',          'derived', 1, 'Price per share divided by book value per share.'),
  ('ps_ratio',              'Price / Sales',              'ratio',    'derived',      'neutral',          'derived', 1, 'Market cap divided by trailing revenue.'),
  ('ev_to_ebitda',          'EV / EBITDA',                'ratio',    'derived',      'neutral',          'derived', 1, 'Enterprise value divided by trailing EBITDA.'),
  ('peg_ratio',             'PEG',                        'ratio',    'derived',      'neutral',          'derived', 1, 'P/E divided by expected EPS growth rate.'),

  -- Market data
  ('price',                 'Price',                      'currency', 'point_in_time', 'neutral',         'market',  1, 'Last trade or quote price in the listing currency.'),
  ('market_cap',            'Market Capitalization',      'currency', 'point_in_time', 'neutral',         'derived', 1, 'Shares outstanding multiplied by price.'),
  ('enterprise_value',      'Enterprise Value',           'currency', 'derived',      'neutral',          'derived', 1, 'Market cap plus total debt less cash and equivalents.'),
  ('volume',                'Volume',                     'count',    'sum',          'neutral',          'market',  1, 'Shares traded over the period.'),
  ('dividend_per_share',    'Dividend Per Share',         'currency', 'sum',          'higher_is_better', 'gaap',    1, 'Dividends declared per share for the period.'),
  ('dividend_yield',        'Dividend Yield',             'percent',  'derived',      'higher_is_better', 'derived', 1, 'Trailing dividends per share divided by price.'),

  -- Growth
  ('revenue_growth_yoy',    'Revenue Growth (YoY)',       'percent',  'yoy',          'higher_is_better', 'derived', 1, 'Year-over-year percentage change in revenue.'),
  ('eps_growth_yoy',        'EPS Growth (YoY)',           'percent',  'yoy',          'higher_is_better', 'derived', 1, 'Year-over-year percentage change in diluted EPS.'),

  -- Analyst consensus (vendor)
  ('analyst_count',              'Analyst Count',  'count', 'point_in_time', 'neutral', 'vendor', 1, 'Number of analysts providing coverage.'),
  ('analyst_rating_strong_buy',  'Strong Buy',     'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating strong buy.'),
  ('analyst_rating_buy',         'Buy',            'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating buy.'),
  ('analyst_rating_hold',        'Hold',           'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating hold.'),
  ('analyst_rating_sell',        'Sell',           'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating sell.'),
  ('analyst_rating_strong_sell', 'Strong Sell',    'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating strong sell.'),

  -- Analyst price targets (vendor)
  ('price_target_low',           'Price Target Low',  'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Lowest analyst price target.'),
  ('price_target_mean',          'Price Target Mean', 'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Mean analyst price target.'),
  ('price_target_high',          'Price Target High', 'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Highest analyst price target.'),

  -- Momentum and technical signals (vendor; xang1234/stock-screener weekly-reference feed)
  ('rsi_14',                'RSI (14)',                   'ratio',    'point_in_time', 'neutral', 'vendor', 1, '14-day relative strength index.'),
  ('perf_week',             'Performance (1W)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Trailing one-week price performance.'),
  ('perf_month',            'Performance (1M)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Trailing one-month price performance.'),
  ('perf_quarter',          'Performance (3M)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Trailing three-month price performance.'),
  ('perf_half_year',        'Performance (6M)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Trailing six-month price performance.'),
  ('perf_year',             'Performance (1Y)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Trailing one-year price performance.'),
  ('perf_ytd',              'Performance (YTD)',          'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Year-to-date price performance.'),
  ('sma_20',                'Price vs SMA(20)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Percent distance of price from its 20-day simple moving average.'),
  ('sma_50',                'Price vs SMA(50)',           'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Percent distance of price from its 50-day simple moving average.'),
  ('sma_200',               'Price vs SMA(200)',          'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Percent distance of price from its 200-day simple moving average.'),
  ('week_52_high',          '52-Week High',               'currency', 'point_in_time', 'neutral', 'market', 1, 'Highest trade price over the trailing 52 weeks.'),
  ('week_52_low',           '52-Week Low',                'currency', 'point_in_time', 'neutral', 'market', 1, 'Lowest trade price over the trailing 52 weeks.'),
  ('week_52_high_distance', 'Distance from 52-Week High', 'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Percent distance of price below the 52-week high.'),
  ('week_52_low_distance',  'Distance from 52-Week Low',  'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Percent distance of price above the 52-week low.'),
  ('short_float',           'Short Float',                'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Shares sold short as a percent of float.'),
  ('relative_volume',       'Relative Volume',            'ratio',    'point_in_time', 'neutral', 'vendor', 1, 'Current volume relative to its average.'),
  ('avg_volume',            'Average Volume',             'count',    'avg',           'neutral', 'vendor', 1, 'Average daily share volume.'),
  ('atr_14',                'ATR (14)',                   'currency', 'point_in_time', 'neutral', 'vendor', 1, '14-day average true range in price units.'),
  ('volatility_week',       'Volatility (1W)',            'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Average daily price volatility over the past week.'),
  ('volatility_month',      'Volatility (1M)',            'percent',  'point_in_time', 'neutral', 'vendor', 1, 'Average daily price volatility over the past month.'),

  -- Institutional ownership (SEC 13F, fra-ajvd.4)
  ('institutional_ownership_pct', 'Institutional Ownership', 'percent', 'point_in_time', 'neutral', 'derived', 1, 'Percent of shares outstanding held by reporting institutions (13F).'),
  ('institutional_holders_count', 'Institutional Holders',   'count',   'point_in_time', 'neutral', 'derived', 1, 'Number of institutions reporting a position in the issuer (13F).')
on conflict (metric_key) do nothing;
