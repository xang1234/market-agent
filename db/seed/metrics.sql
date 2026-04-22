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
  ('eps_growth_yoy',        'EPS Growth (YoY)',           'percent',  'yoy',          'higher_is_better', 'derived', 1, 'Year-over-year percentage change in diluted EPS.')
on conflict (metric_key) do nothing;
