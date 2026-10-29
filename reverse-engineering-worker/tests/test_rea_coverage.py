"""REA output normalization contracts, not real engine activation evidence."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import base_result, WorkerError
from engine import normalize_rea_result


class ReaCoverageTests(unittest.TestCase):
    def invoke(self, raw):
        result = base_result('rea', 'contract-fixture')
        normalize_rea_result(result, raw)
        return result

    def test_partial_scope_survives_truncation_of_the_raw_graph(self):
        raw = {'confidence': 'derived', 'limitations': ['Known upstream resource bound'],
               'normalized_result': {'statistics': {'parsed_javascript_files': 2},
                                    'graph': {'nodes': [{'label': 'index.js', 'source': 'x' * 100000}], 'coverage': {'status': 'partial'}},
                                    'semantic_graph': {'coverage': {'status': 'partial', 'truncated': True}, 'limitations': ['Semantic relationships incomplete']}}}
        result = self.invoke(raw)
        self.assertIn('Known upstream resource bound', result['limitations'])
        self.assertIn('Semantic relationships incomplete', result['limitations'])
        self.assertIn('partial coverage', result['summary'])
        self.assertEqual(result['findings'][0]['confidence'], 'inference')
        self.assertEqual(result['evidence'][0]['name'], 'REA declared analysis coverage')
        coverage = json.loads(result['evidence'][0]['content'])
        self.assertEqual(coverage['application']['status'], 'partial')
        self.assertTrue(result['evidence'][1]['metadata']['truncated'])
        self.assertLessEqual(len(result['evidence'][1]['content'].encode()), 65536)

    def test_complete_observations_are_retained_without_inventing_partial_scope(self):
        result = self.invoke({'confidence': 'observed', 'normalized_result': {'graph': {'nodes': [{'label': 'owned.js'}], 'coverage': {'status': 'complete'}}, 'semantic_graph': {'coverage': {'status': 'complete'}}}})
        self.assertEqual(result['findings'][0]['confidence'], 'confirmed')
        self.assertNotIn('partial coverage', result['summary'])
        self.assertFalse(result['evidence'][1]['metadata']['truncated'])

    def test_empty_or_error_output_is_not_published_as_success(self):
        for raw in [{}, [], {'error': 'upstream failure'}, {'normalized_result': {'graph': {'nodes': []}}}, {'normalized_result': {'graph': {'nodes': [None, {}]}}}]:
            with self.subTest(raw=raw), self.assertRaises(WorkerError):
                self.invoke(raw)


if __name__ == '__main__':
    unittest.main()
