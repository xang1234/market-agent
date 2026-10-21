update metrics set metric_key = 'shares_outstanding_basic', display_name = 'Shares Outstanding (Basic)'
 where metric_key = 'weighted_average_basic_shares';
update metrics set metric_key = 'shares_outstanding_diluted', display_name = 'Shares Outstanding (Diluted)'
 where metric_key = 'weighted_average_diluted_shares';
