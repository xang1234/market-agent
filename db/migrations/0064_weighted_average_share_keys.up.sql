-- SEC ingestion stores WeightedAverageNumberOf*SharesOutstanding* under these
-- keys. They are weighted averages, not point-in-time counts, so they take the
-- financial engine's key for that figure. Facts reference metric_id, so
-- renaming the registry row carries them.
update metrics set metric_key = 'weighted_average_basic_shares', display_name = 'Weighted-average basic shares'
 where metric_key = 'shares_outstanding_basic';
update metrics set metric_key = 'weighted_average_diluted_shares', display_name = 'Weighted-average diluted shares'
 where metric_key = 'shares_outstanding_diluted';
