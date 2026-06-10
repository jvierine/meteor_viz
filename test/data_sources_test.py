import tempfile
import unittest
from pathlib import Path

from data_sources import active_partial_download


class DataSourcesTest(unittest.TestCase):
    def test_active_partial_download_detects_browser_temp_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "maarsy_dataset.h5"
            partial = Path(f"{target}.crdownload")
            partial.write_bytes(b"partial")
            self.assertEqual(active_partial_download(target), partial)


if __name__ == "__main__":
    unittest.main()
