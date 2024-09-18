import datetime
from lib.env import DATA_PATH
import os
import pandas as pd

def datetime_to_epoch(year, month, day, hour, minute, second):
    # Create the datetime object
    dt = datetime.datetime(year, month, day, hour, minute, second)
    
    # Subtract 4 hours (to convert from EST to UTC)
    dt_utc = dt - datetime.timedelta(hours=4)
    
    # Convert to epoch time
    epoch_time = int(dt_utc.timestamp())
    
    # Return nanoseconds as requested
    return epoch_time * 1e9

