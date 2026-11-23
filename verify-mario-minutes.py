"""Variable rewards, validation, deduplication and lossless schema upgrade."""
import copy
import importlib.util
import sqlite3
import tempfile
from pathlib import Path
from uuid import uuid4

spec = importlib.util.spec_from_file_location('bunny', Path(__file__).parent/'tool/bunny-server.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def event(grade, total, score):
    evidence = []
    for i in range(total):
        subject = ('russian', 'math', 'english')[i % 3]
        keys = ([k for k, g in b.REWARD_TOPIC_GRADES.items() if g == grade] if subject == 'russian'
                else [k for k, v in b.MARIO_SCHOOL_TOPICS.items() if v == [subject, grade]])[:2]
        evidence.append(dict(subject=subject, grade=grade, topic=keys[(i // 3) % 2], correct=i < score))
    return dict(kind='round', id=str(uuid4()), total=total, score=score, review=False,
                topics=list({i['topic'] for i in evidence}), marioMission=evidence)


with tempfile.TemporaryDirectory() as directory:
    path = Path(directory)/'progress.sqlite'
    # An actual pre-upgrade schema, including a used ticket and a paused session.
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE mario_tickets (player TEXT, round TEXT, created REAL NOT NULL, used REAL, PRIMARY KEY(player,round))')
        db.execute('INSERT INTO mario_tickets VALUES ("old","ticket",1,NULL)')
        db.execute('CREATE TABLE mario_pauses (player TEXT PRIMARY KEY, session TEXT NOT NULL, remaining REAL NOT NULL CHECK(remaining >= 0 AND remaining <= 600))')
        db.execute('INSERT INTO mario_pauses VALUES ("old","session",357.25)')
    b.initialize_database(path)
    b.initialize_database(path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT seconds,used FROM mario_tickets').fetchone() == (600, None)
        assert db.execute('SELECT remaining FROM mario_pauses').fetchone()[0] == 357.25
        db.execute('UPDATE mario_pauses SET remaining=1380')
        for grade, classes, cases in [(2, [1, 2], [(20, 16, 10), (20, 15, 0), (50, 40, 13), (50, 39, 0)]),
                                      (4, [3, 4], [(30, 26, 10), (30, 25, 0), (50, 44, 12), (50, 43, 0)])]:
            for total, score, expected in cases:
                p = b.initial_profile();p['schoolClasses'] = classes
                e = event(grade, total, score)
                receipt = b.BunnyHandler.update(db, str(uuid4()), p, e)
                assert (receipt['marioMinutes'], receipt['marioUnlock']) == (expected, True), (grade, total, score)
                assert b.mario_round_reward(p, e) == (expected, True)
            p = b.initial_profile();p['schoolClasses'] = classes
            for total in [10, 20, 30, 50, 100]:
                threshold = b.math.ceil(total * (0.8 if grade == 2 else 26/30))
                e = dict(kind='round', id=str(uuid4()), total=total, score=threshold, topics=['add'], review=False)
                assert b.mario_round_reward(p, e) == (total//10, False)
                assert b.mario_round_reward(p, dict(e, score=threshold-1, corrected=1)) == (0, False)
                assert b.mario_round_reward(p, dict(e, review=True)) == (0, False)
        p = b.initial_profile();p['schoolClasses'] = [1, 2]
        e = event(2, 50, 40)
        r = b.BunnyHandler.update(db, 'julia', p, e)
        snapshot = copy.deepcopy(p)
        assert b.BunnyHandler.update(db, 'julia', p, e) is None and snapshot == p
        assert db.execute('SELECT seconds FROM mario_tickets WHERE player="julia"').fetchone()[0] == 780
        assert db.execute('SELECT count(*) FROM mario_rewards WHERE player="julia"').fetchone()[0] == 1
        for change in ['two-subjects', 'one-topic', 'wrong-class', 'unbalanced', 'fake-score', 'unknown-topic', 'extra-reward', 'review', 'short']:
            bad = copy.deepcopy(e);bad['id'] = str(uuid4())
            if change == 'two-subjects':
                for item in bad['marioMission']:
                    if item['subject'] == 'english':item.update(subject='math', topic='math2problems')
            elif change == 'one-topic':
                for item in bad['marioMission']:
                    if item['subject'] == 'russian':item['topic'] = 'chk'
            elif change == 'wrong-class':bad['marioMission'][0]['grade'] = 4
            elif change == 'unbalanced':bad['marioMission'][-1].update(subject='russian', topic='chk')
            elif change == 'fake-score':bad['score'] = 41
            elif change == 'unknown-topic':bad['marioMission'][0]['topic'] = 'fake'
            elif change == 'extra-reward':bad['mission'] = 'mario'
            elif change == 'review':bad['review'] = True
            elif change == 'short':bad['total'] = 10
            try:b.mario_round_reward(p, bad)
            except ValueError:pass
            else:raise AssertionError(change)
    b.initialize_database(path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT remaining FROM mario_pauses').fetchone()[0] == 1380
print('PASS minutes: Julia 20/50, Sonya 30/50, ordinary 10/20/30/50/100; first answers only, three balanced subjects, topics/classes, dedup, old tickets and paused seconds preserved')
