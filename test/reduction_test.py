import unittest

import numpy as np

from reduce_maarsy_dataset import jopek_dh


class JopekDhSanityTest(unittest.TestCase):
    def test_identical_orbits_have_zero_distance(self):
        orbit = np.array([[1.33, 0.89, 23.5, 324.0, 260.0, 17.0]])
        self.assertAlmostEqual(float(jopek_dh(orbit, orbit)[0]), 0.0, places=14)

    def test_anomaly_is_ignored_by_similarity(self):
        a = np.array([[1.33, 0.89, 23.5, 324.0, 260.0, 0.0]])
        b = np.array([[1.33, 0.89, 23.5, 324.0, 260.0, 180.0]])
        self.assertAlmostEqual(float(jopek_dh(a, b)[0]), 0.0, places=14)

    def test_angle_wrapping_near_zero_degrees_is_continuous(self):
        a = np.array([[1.0, 0.5, 10.0, 359.9, 0.1, 0.0]])
        b = np.array([[1.0, 0.5, 10.0, 0.1, 359.9, 0.0]])
        self.assertLess(float(jopek_dh(a, b)[0]), 0.002)

    def test_perihelion_distance_term_is_relative(self):
        a = np.array([[2.0, 0.5, 10.0, 30.0, 40.0, 0.0]])
        b = np.array([[2.2, 0.5, 10.0, 30.0, 40.0, 0.0]])
        qa = 2.0 * (1.0 - 0.5)
        qb = 2.2 * (1.0 - 0.5)
        expected = abs(qb - qa) / (qa + qb)
        self.assertAlmostEqual(float(jopek_dh(a, b)[0]), expected, places=14)


if __name__ == "__main__":
    unittest.main()
