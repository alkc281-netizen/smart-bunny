#!/usr/bin/env python3
"""Serve the home game and store private player progress outside its web root."""
import argparse
import hashlib
import hmac
import ipaddress
import json
import math
import os
import secrets
import sqlite3
import time
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import UUID, uuid4


AVATARS = {"🌸", "⭐", "🐰", "🦊"}
PREFERENCES = {
    "bunny-russian-class", "bunny-russian-count", "bunny-russian-grade-1",
    "bunny-russian-mistakes", "bunny-russian-studied-2", "bunny-russian-studied-4",
}
PREFERENCES |= {f"bunny-school-{subject}-{setting}" for subject in ("math", "english", "world")
                for setting in ("class", "count", "studied2", "studied4", "mistakes")}
# BEGIN GENERATED STICKER CATALOG
REWARD_PRICES = {'mushroom': 5, 'star': 6, 'koopa': 7, 'mario': 10, 'chip': 7, 'dale': 7, 'darkwing': 12, 'gadget': 8, 'monty': 9, 'zipper': 10, 'fatcat': 11, 'wart': 8, 'mole': 9, 'mepps': 10, 'nimnul': 11, 'snout': 12, 'mandy': 8, 'launchpad': 8, 'gosalyn': 9, 'honker': 10, 'morgana': 11, 'gizmoduck': 12, 'stegmutt': 8, 'neptunia': 9, 'negaduck': 10, 'bushroot': 11, 'liquidator': 12, 'megavolt': 8, 'quackerjack': 9, 'steelbeak': 10, 'tuskernini': 11, 'moliarty': 12, 'wolfduck': 8, 'jgander': 9, 'grizzlikoff': 10, 'ammonia': 11, 'splatterphoenix': 12, 'dddonald': 7, 'dddaisy': 8, 'ddscrooge': 10, 'ddhuey': 8, 'dddewey': 7, 'ddlouie': 10, 'ddwebby': 7, 'ddbeakley': 8, 'ddduckworth': 10, 'ddgyro': 8, 'ddlittlehelper': 7, 'dddoofus': 10, 'ddgladstone': 7, 'ddfethry': 8, 'ddgrandma': 10, 'ddludwig': 8, 'ddgoldie': 7, 'dddella': 10, 'ddgandra': 7, 'ddmagica': 8, 'ddpoe': 10, 'ddglomgold': 8, 'ddmabeagle': 7, 'ddbigtime': 10, 'ddburger': 7, 'ddbouncer': 8, 'ddbubba': 10, 'ddmerlock': 8, 'ddjose': 7, 'ddpanchito': 10, 'ddlittlehelpercutout': 7, 'ddlena': 8, 'ddviolet': 10, 'ddrockerduck': 8, 'mmmickey': 7, 'mmminnie': 8, 'mmgoofy': 10, 'mmpluto': 8, 'mmclarabelle': 7, 'mmhorace': 10, 'mmpete': 7, 'mmtrudy': 8, 'mmscuttle': 10, 'mmshyster': 8, 'mmohara': 7, 'mmcasey': 10, 'mmeega': 7, 'mmindiana': 8, 'mmgilbert': 10, 'mmmortimer': 8, 'mmfigaro': 7, 'mmatomo': 10, 'mmellsworth': 7, 'mmbutch': 8, 'mmfips': 10, 'mmdoberman': 8, 'mmpowerline': 7, 'mmhicksi': 10, 'mmunclemortimer': 7, 'mmclarice': 8, 'mmmax': 10, 'mmoswald': 8, 'mmroxanne': 7, 'mmphantom': 10, 'ltbugs': 7, 'ltdaffy': 7, 'ltporky': 8, 'lttweety': 8, 'ltsylvester': 10, 'ltelmer': 7, 'ltsam': 7, 'ltspeedy': 8, 'ltcoyote': 8, 'ltroadrunner': 10, 'ltmarvin': 7, 'lttaz': 7, 'ltpepe': 8, 'ltpenelope': 8, 'ltgranny': 10, 'ltpete': 7, 'ltfoghorn': 7, 'ltbarnyard': 8, 'lthenery': 8, 'ltralph': 10, 'ltsheepdog': 7, 'ltgossamer': 7, 'lthazel': 8, 'lthippety': 8, 'ltsylvesterjr': 10, 'ltmarcantony': 7, 'ltpussyfoot': 7, 'ltcecil': 8, 'ltslowpoke': 8, 'ltclaude': 10, 'tjtom': 7, 'tjjerry': 7, 'tjspike': 8, 'tjtyke': 8, 'tjbutch': 10, 'tjtuffy': 7, 'tjquacker': 7, 'tjtoodles': 8, 'tjlightning': 8, 'tjtopsy': 10, 'tjmeathead': 7, 'tjmuscles': 7, 'tjpecos': 8, 'tjgeorgecat': 8, 'tjcuckoo': 10, 'tjlion': 7, 'tjjumbo': 7, 'tjjumbomother': 8, 'tjpenguin': 8, 'tjwoodpecker': 10, 'tjmotherduck': 7, 'tjgeorgeowner': 7, 'tjjoan': 8, 'tjmammy': 8, 'tjjeannie': 10, 'tjbaby': 7, 'tjrobyn': 7, 'tjpristine': 8, 'tjlickboot': 8, 'tjkiddie': 10, 'wwwoody': 7, 'wwwinnie': 7, 'wwknothead': 8, 'wwsplinter': 8, 'wwbuzz': 10, 'wwwally': 7, 'wwgabby': 7, 'wwdooley': 8, 'wwmeany': 8, 'wwchilly': 10, 'wwsmedley': 7, 'wwmaxie': 7, 'wwgooney': 8, 'wwandy': 8, 'wwmiranda': 10, 'wwpoppa': 7, 'wwcharliechicken': 7, 'wwwilloughby': 8, 'wwsugarfoot': 8, 'wwhomer': 10, 'wwcarrie': 7, 'wwcharliebeary': 7, 'wwbessie': 8, 'wwjunior': 8, 'wwsuzy': 10, 'wwdoc': 7, 'wwduffy': 7, 'wwfink': 8, 'wwcuddles': 8, 'wwfatso': 10}
MISSION_REWARDS = ('mushroom', 'koopa', 'mario', 'chip', 'dale', 'darkwing', 'gadget', 'monty', 'zipper', 'fatcat', 'wart', 'mole', 'mepps', 'nimnul', 'snout', 'mandy', 'launchpad', 'gosalyn', 'honker', 'morgana', 'gizmoduck', 'stegmutt', 'neptunia', 'negaduck', 'bushroot', 'liquidator', 'megavolt', 'quackerjack', 'steelbeak', 'tuskernini', 'moliarty', 'wolfduck', 'jgander', 'grizzlikoff', 'ammonia', 'splatterphoenix', 'dddonald', 'dddaisy', 'ddscrooge', 'ddhuey', 'dddewey', 'ddlouie', 'ddwebby', 'ddbeakley', 'ddduckworth', 'ddgyro', 'ddlittlehelper', 'dddoofus', 'ddgladstone', 'ddfethry', 'ddgrandma', 'ddludwig', 'ddgoldie', 'dddella', 'ddgandra', 'ddmagica', 'ddpoe', 'ddglomgold', 'ddmabeagle', 'ddbigtime', 'ddburger', 'ddbouncer', 'ddbubba', 'ddmerlock', 'ddjose', 'ddpanchito', 'ddlittlehelpercutout', 'ddlena', 'ddviolet', 'ddrockerduck', 'mmmickey', 'mmminnie', 'mmgoofy', 'mmpluto', 'mmclarabelle', 'mmhorace', 'mmpete', 'mmtrudy', 'mmscuttle', 'mmshyster', 'mmohara', 'mmcasey', 'mmeega', 'mmindiana', 'mmgilbert', 'mmmortimer', 'mmfigaro', 'mmatomo', 'mmellsworth', 'mmbutch', 'mmfips', 'mmdoberman', 'mmpowerline', 'mmhicksi', 'mmunclemortimer', 'mmclarice', 'mmmax', 'mmoswald', 'mmroxanne', 'mmphantom', 'ltbugs', 'ltdaffy', 'ltporky', 'lttweety', 'ltsylvester', 'ltelmer', 'ltsam', 'ltspeedy', 'ltcoyote', 'ltroadrunner', 'ltmarvin', 'lttaz', 'ltpepe', 'ltpenelope', 'ltgranny', 'ltpete', 'ltfoghorn', 'ltbarnyard', 'lthenery', 'ltralph', 'ltsheepdog', 'ltgossamer', 'lthazel', 'lthippety', 'ltsylvesterjr', 'ltmarcantony', 'ltpussyfoot', 'ltcecil', 'ltslowpoke', 'ltclaude', 'tjtom', 'tjjerry', 'tjspike', 'tjtyke', 'tjbutch', 'tjtuffy', 'tjquacker', 'tjtoodles', 'tjlightning', 'tjtopsy', 'tjmeathead', 'tjmuscles', 'tjpecos', 'tjgeorgecat', 'tjcuckoo', 'tjlion', 'tjjumbo', 'tjjumbomother', 'tjpenguin', 'tjwoodpecker', 'tjmotherduck', 'tjgeorgeowner', 'tjjoan', 'tjmammy', 'tjjeannie', 'tjbaby', 'tjrobyn', 'tjpristine', 'tjlickboot', 'tjkiddie', 'wwwoody', 'wwwinnie', 'wwknothead', 'wwsplinter', 'wwbuzz', 'wwwally', 'wwgabby', 'wwdooley', 'wwmeany', 'wwchilly', 'wwsmedley', 'wwmaxie', 'wwgooney', 'wwandy', 'wwmiranda', 'wwpoppa', 'wwcharliechicken', 'wwwilloughby', 'wwsugarfoot', 'wwhomer', 'wwcarrie', 'wwcharliebeary', 'wwbessie', 'wwjunior', 'wwsuzy', 'wwdoc', 'wwduffy', 'wwfink', 'wwcuddles', 'wwfatso')
MISSION_TYPES = {'mushroom': 'russian', 'koopa': 'math', 'mario': 'mixed', 'chip': 'russian', 'dale': 'math', 'darkwing': 'mixed', 'gadget': 'russian', 'monty': 'math', 'zipper': 'mixed', 'fatcat': 'mixed', 'wart': 'russian', 'mole': 'math', 'mepps': 'mixed', 'nimnul': 'math', 'snout': 'russian', 'mandy': 'mixed', 'launchpad': 'math', 'gosalyn': 'russian', 'honker': 'mixed', 'morgana': 'mixed', 'gizmoduck': 'math', 'stegmutt': 'math', 'neptunia': 'mixed', 'negaduck': 'mixed', 'bushroot': 'russian', 'liquidator': 'mixed', 'megavolt': 'math', 'quackerjack': 'mixed', 'steelbeak': 'mixed', 'tuskernini': 'russian', 'moliarty': 'math', 'wolfduck': 'mixed', 'jgander': 'russian', 'grizzlikoff': 'mixed', 'ammonia': 'math', 'splatterphoenix': 'russian', 'dddonald': 'math', 'dddaisy': 'russian', 'ddscrooge': 'mixed', 'ddhuey': 'math', 'dddewey': 'russian', 'ddlouie': 'mixed', 'ddwebby': 'math', 'ddbeakley': 'russian', 'ddduckworth': 'mixed', 'ddgyro': 'math', 'ddlittlehelper': 'russian', 'dddoofus': 'mixed', 'ddgladstone': 'math', 'ddfethry': 'russian', 'ddgrandma': 'mixed', 'ddludwig': 'math', 'ddgoldie': 'russian', 'dddella': 'mixed', 'ddgandra': 'math', 'ddmagica': 'russian', 'ddpoe': 'mixed', 'ddglomgold': 'math', 'ddmabeagle': 'russian', 'ddbigtime': 'mixed', 'ddburger': 'math', 'ddbouncer': 'russian', 'ddbubba': 'mixed', 'ddmerlock': 'math', 'ddjose': 'russian', 'ddpanchito': 'mixed', 'ddlittlehelpercutout': 'math', 'ddlena': 'russian', 'ddviolet': 'mixed', 'ddrockerduck': 'math', 'mmmickey': 'math', 'mmminnie': 'russian', 'mmgoofy': 'mixed', 'mmpluto': 'math', 'mmclarabelle': 'russian', 'mmhorace': 'mixed', 'mmpete': 'math', 'mmtrudy': 'russian', 'mmscuttle': 'mixed', 'mmshyster': 'math', 'mmohara': 'russian', 'mmcasey': 'mixed', 'mmeega': 'math', 'mmindiana': 'russian', 'mmgilbert': 'mixed', 'mmmortimer': 'math', 'mmfigaro': 'russian', 'mmatomo': 'mixed', 'mmellsworth': 'math', 'mmbutch': 'russian', 'mmfips': 'mixed', 'mmdoberman': 'math', 'mmpowerline': 'russian', 'mmhicksi': 'mixed', 'mmunclemortimer': 'math', 'mmclarice': 'russian', 'mmmax': 'mixed', 'mmoswald': 'math', 'mmroxanne': 'russian', 'mmphantom': 'mixed', 'ltbugs': 'math', 'ltdaffy': 'russian', 'ltporky': 'math', 'lttweety': 'russian', 'ltsylvester': 'mixed', 'ltelmer': 'math', 'ltsam': 'russian', 'ltspeedy': 'math', 'ltcoyote': 'russian', 'ltroadrunner': 'mixed', 'ltmarvin': 'math', 'lttaz': 'russian', 'ltpepe': 'math', 'ltpenelope': 'russian', 'ltgranny': 'mixed', 'ltpete': 'math', 'ltfoghorn': 'russian', 'ltbarnyard': 'math', 'lthenery': 'russian', 'ltralph': 'mixed', 'ltsheepdog': 'math', 'ltgossamer': 'russian', 'lthazel': 'math', 'lthippety': 'russian', 'ltsylvesterjr': 'mixed', 'ltmarcantony': 'math', 'ltpussyfoot': 'russian', 'ltcecil': 'math', 'ltslowpoke': 'russian', 'ltclaude': 'mixed', 'tjtom': 'math', 'tjjerry': 'russian', 'tjspike': 'math', 'tjtyke': 'russian', 'tjbutch': 'mixed', 'tjtuffy': 'math', 'tjquacker': 'russian', 'tjtoodles': 'math', 'tjlightning': 'russian', 'tjtopsy': 'mixed', 'tjmeathead': 'math', 'tjmuscles': 'russian', 'tjpecos': 'math', 'tjgeorgecat': 'russian', 'tjcuckoo': 'mixed', 'tjlion': 'math', 'tjjumbo': 'russian', 'tjjumbomother': 'math', 'tjpenguin': 'russian', 'tjwoodpecker': 'mixed', 'tjmotherduck': 'math', 'tjgeorgeowner': 'russian', 'tjjoan': 'math', 'tjmammy': 'russian', 'tjjeannie': 'mixed', 'tjbaby': 'math', 'tjrobyn': 'russian', 'tjpristine': 'math', 'tjlickboot': 'russian', 'tjkiddie': 'mixed', 'wwwoody': 'math', 'wwwinnie': 'russian', 'wwknothead': 'math', 'wwsplinter': 'russian', 'wwbuzz': 'mixed', 'wwwally': 'math', 'wwgabby': 'russian', 'wwdooley': 'math', 'wwmeany': 'russian', 'wwchilly': 'mixed', 'wwsmedley': 'math', 'wwmaxie': 'russian', 'wwgooney': 'math', 'wwandy': 'russian', 'wwmiranda': 'mixed', 'wwpoppa': 'math', 'wwcharliechicken': 'russian', 'wwwilloughby': 'math', 'wwsugarfoot': 'russian', 'wwhomer': 'mixed', 'wwcarrie': 'math', 'wwcharliebeary': 'russian', 'wwbessie': 'math', 'wwjunior': 'russian', 'wwsuzy': 'mixed', 'wwdoc': 'math', 'wwduffy': 'russian', 'wwfink': 'math', 'wwcuddles': 'russian', 'wwfatso': 'mixed'}
CHARACTER_STICKERS = ('chip', 'dale', 'darkwing', 'gadget', 'monty', 'zipper', 'fatcat', 'wart', 'mole', 'mepps', 'nimnul', 'snout', 'mandy', 'launchpad', 'gosalyn', 'honker', 'morgana', 'gizmoduck', 'stegmutt', 'neptunia', 'negaduck', 'bushroot', 'liquidator', 'megavolt', 'quackerjack', 'steelbeak', 'tuskernini', 'moliarty', 'wolfduck', 'jgander', 'grizzlikoff', 'ammonia', 'splatterphoenix', 'dddonald', 'dddaisy', 'ddscrooge', 'ddhuey', 'dddewey', 'ddlouie', 'ddwebby', 'ddbeakley', 'ddduckworth', 'ddgyro', 'ddlittlehelper', 'dddoofus', 'ddgladstone', 'ddfethry', 'ddgrandma', 'ddludwig', 'ddgoldie', 'dddella', 'ddgandra', 'ddmagica', 'ddpoe', 'ddglomgold', 'ddmabeagle', 'ddbigtime', 'ddburger', 'ddbouncer', 'ddbubba', 'ddmerlock', 'ddjose', 'ddpanchito', 'ddlittlehelpercutout', 'ddlena', 'ddviolet', 'ddrockerduck', 'mmmickey', 'mmminnie', 'mmgoofy', 'mmpluto', 'mmclarabelle', 'mmhorace', 'mmpete', 'mmtrudy', 'mmscuttle', 'mmshyster', 'mmohara', 'mmcasey', 'mmeega', 'mmindiana', 'mmgilbert', 'mmmortimer', 'mmfigaro', 'mmatomo', 'mmellsworth', 'mmbutch', 'mmfips', 'mmdoberman', 'mmpowerline', 'mmhicksi', 'mmunclemortimer', 'mmclarice', 'mmmax', 'mmoswald', 'mmroxanne', 'mmphantom', 'ltbugs', 'ltdaffy', 'ltporky', 'lttweety', 'ltsylvester', 'ltelmer', 'ltsam', 'ltspeedy', 'ltcoyote', 'ltroadrunner', 'ltmarvin', 'lttaz', 'ltpepe', 'ltpenelope', 'ltgranny', 'ltpete', 'ltfoghorn', 'ltbarnyard', 'lthenery', 'ltralph', 'ltsheepdog', 'ltgossamer', 'lthazel', 'lthippety', 'ltsylvesterjr', 'ltmarcantony', 'ltpussyfoot', 'ltcecil', 'ltslowpoke', 'ltclaude', 'tjtom', 'tjjerry', 'tjspike', 'tjtyke', 'tjbutch', 'tjtuffy', 'tjquacker', 'tjtoodles', 'tjlightning', 'tjtopsy', 'tjmeathead', 'tjmuscles', 'tjpecos', 'tjgeorgecat', 'tjcuckoo', 'tjlion', 'tjjumbo', 'tjjumbomother', 'tjpenguin', 'tjwoodpecker', 'tjmotherduck', 'tjgeorgeowner', 'tjjoan', 'tjmammy', 'tjjeannie', 'tjbaby', 'tjrobyn', 'tjpristine', 'tjlickboot', 'tjkiddie', 'wwwoody', 'wwwinnie', 'wwknothead', 'wwsplinter', 'wwbuzz', 'wwwally', 'wwgabby', 'wwdooley', 'wwmeany', 'wwchilly', 'wwsmedley', 'wwmaxie', 'wwgooney', 'wwandy', 'wwmiranda', 'wwpoppa', 'wwcharliechicken', 'wwwilloughby', 'wwsugarfoot', 'wwhomer', 'wwcarrie', 'wwcharliebeary', 'wwbessie', 'wwjunior', 'wwsuzy', 'wwdoc', 'wwduffy', 'wwfink', 'wwcuddles', 'wwfatso')
CATALOG_ONLY_STICKERS = ('gadget', 'monty', 'zipper', 'fatcat', 'wart', 'mole', 'mepps', 'nimnul', 'snout', 'mandy', 'launchpad', 'gosalyn', 'honker', 'morgana', 'gizmoduck', 'stegmutt', 'neptunia', 'negaduck', 'bushroot', 'liquidator', 'megavolt', 'quackerjack', 'steelbeak', 'tuskernini', 'moliarty', 'wolfduck', 'jgander', 'grizzlikoff', 'ammonia', 'splatterphoenix', 'dddonald', 'dddaisy', 'ddscrooge', 'ddhuey', 'dddewey', 'ddlouie', 'ddwebby', 'ddbeakley', 'ddduckworth', 'ddgyro', 'ddlittlehelper', 'dddoofus', 'ddgladstone', 'ddfethry', 'ddgrandma', 'ddludwig', 'ddgoldie', 'dddella', 'ddgandra', 'ddmagica', 'ddpoe', 'ddglomgold', 'ddmabeagle', 'ddbigtime', 'ddburger', 'ddbouncer', 'ddbubba', 'ddmerlock', 'ddjose', 'ddpanchito', 'ddlittlehelpercutout', 'ddlena', 'ddviolet', 'ddrockerduck', 'mmmickey', 'mmminnie', 'mmgoofy', 'mmpluto', 'mmclarabelle', 'mmhorace', 'mmpete', 'mmtrudy', 'mmscuttle', 'mmshyster', 'mmohara', 'mmcasey', 'mmeega', 'mmindiana', 'mmgilbert', 'mmmortimer', 'mmfigaro', 'mmatomo', 'mmellsworth', 'mmbutch', 'mmfips', 'mmdoberman', 'mmpowerline', 'mmhicksi', 'mmunclemortimer', 'mmclarice', 'mmmax', 'mmoswald', 'mmroxanne', 'mmphantom', 'ltbugs', 'ltdaffy', 'ltporky', 'lttweety', 'ltsylvester', 'ltelmer', 'ltsam', 'ltspeedy', 'ltcoyote', 'ltroadrunner', 'ltmarvin', 'lttaz', 'ltpepe', 'ltpenelope', 'ltgranny', 'ltpete', 'ltfoghorn', 'ltbarnyard', 'lthenery', 'ltralph', 'ltsheepdog', 'ltgossamer', 'lthazel', 'lthippety', 'ltsylvesterjr', 'ltmarcantony', 'ltpussyfoot', 'ltcecil', 'ltslowpoke', 'ltclaude', 'tjtom', 'tjjerry', 'tjspike', 'tjtyke', 'tjbutch', 'tjtuffy', 'tjquacker', 'tjtoodles', 'tjlightning', 'tjtopsy', 'tjmeathead', 'tjmuscles', 'tjpecos', 'tjgeorgecat', 'tjcuckoo', 'tjlion', 'tjjumbo', 'tjjumbomother', 'tjpenguin', 'tjwoodpecker', 'tjmotherduck', 'tjgeorgeowner', 'tjjoan', 'tjmammy', 'tjjeannie', 'tjbaby', 'tjrobyn', 'tjpristine', 'tjlickboot', 'tjkiddie', 'wwwoody', 'wwwinnie', 'wwknothead', 'wwsplinter', 'wwbuzz', 'wwwally', 'wwgabby', 'wwdooley', 'wwmeany', 'wwchilly', 'wwsmedley', 'wwmaxie', 'wwgooney', 'wwandy', 'wwmiranda', 'wwpoppa', 'wwcharliechicken', 'wwwilloughby', 'wwsugarfoot', 'wwhomer', 'wwcarrie', 'wwcharliebeary', 'wwbessie', 'wwjunior', 'wwsuzy', 'wwdoc', 'wwduffy', 'wwfink', 'wwcuddles', 'wwfatso')
# END GENERATED STICKER CATALOG
DAILY_MISSIONS = ("koopa", "mushroom", "mario")
PASSWORD_ROUNDS = 600000
# Kept in sync with the actual Russian curriculum by verify-achievements.cjs.
REWARD_TOPIC_GRADES = {'capital': 1, 'zhi': 1, 'cha': 1, 'chu': 1, 'chk': 2, 'soft': 2, 'vowels': 2, 'pairs': 2, 'separators': 3, 'silent': 3, 'prefix': 3, 'review': 4, 'nouns': 4, 'adjectives': 4, 'notVerbs': 4, 'sounds1': 1, 'transfer1': 1, 'sounds2': 2, 'transfer2': 2, 'dictionary1': 1, 'dictionary2': 2, 'meaning1': 1, 'meaning2': 2, 'meaning3': 3, 'meaning4': 4, 'roots2': 2, 'roots3': 3, 'speech1': 1, 'speech2': 2, 'forms2': 2, 'nouns3': 3, 'adjectives3': 3, 'verbs3': 3, 'structure3': 3, 'structure4': 4, 'sentence1': 1, 'members3': 3, 'conjugation4': 4, 'tsya4': 4, 'hush4': 4, 'doubles3': 3, 'reading1': 1, 'text2': 2, 'text3': 3, 'text4': 4, 'reading4': 4, 'etiquette3': 3, 'sentence4': 4, 'complex4': 4, 'speech4': 4, 'adverb4': 4, 'cases4': 4, 'declension4': 4, 'stress4': 4, 'homonyms4': 4, 'idioms4': 4, 'dialogue2': 2, 'textParts2': 2, 'alphabet2': 2}
ALBUM_DECORATIONS = {"dots": {"name": "Горошек", "cost": 5},
                     "stars": {"name": "Звёздочки", "cost": 8},
                     "space": {"name": "Космос", "cost": 10}}


def junior_rewards(profile):
    return profile.get("stickerPolicy") == "junior-v1"


def mission_condition(profile, key):
    kind = MISSION_TYPES[key]
    tier = "special" if kind == "mixed" else "rare" if REWARD_PRICES[key] > 7 else "ordinary"
    junior = junior_rewards(profile)
    count = 10 if junior else 30 if tier == "special" else 20
    required = (8 if tier == "special" else 7) if junior else (27 if tier == "special" else 17 if tier == "rare" else 16)
    stages = list(dict.fromkeys(profile.get("stickerStages", {}).get(key, [])))[:2]
    return dict(type=kind, tier=tier, count=count, required=required, stages=2 if tier == "rare" else 1,
                completedTopics=stages, countCorrections=junior)


def reward_russian_topics(profile, grade):
    if type(grade) is not int or grade not in school_classes(profile):
        return set()
    if grade in (2, 4):
        try:
            studied = json.loads(profile["preferences"].get("bunny-russian-studied-" + str(grade), "[]"))
        except (ValueError, TypeError):
            return set()
        if not isinstance(studied, list):
            return set()
    else:
        studied = profile["topics"]
    return {topic for topic in studied if isinstance(topic, str) and REWARD_TOPIC_GRADES.get(topic) == grade}


def apply_mission_achievement(profile, data):
    key = data["mission"]
    rule = mission_condition(profile, key)
    # Old/offline tabs keep their academic result, but cannot bypass new rules.
    valid = data.get("rewardVersion") == 2 and data["total"] == rule["count"]
    topics = set(data["topics"])
    russian = reward_russian_topics(profile, data.get("missionClass"))
    math_topics = {"compare", "add"}
    if rule["type"] == "math":
        valid = valid and topics <= math_topics and bool(topics)
    elif rule["type"] == "russian":
        valid = valid and topics <= russian and bool(topics)
    else:
        valid = valid and bool(topics & math_topics) and bool(topics & russian) and topics <= math_topics | russian
    if rule["tier"] == "rare":
        valid = valid and len(topics) == 1
    solved = data["score"] + (data.get("corrected", 0) if rule["countCorrections"] else 0)
    passed = bool(valid and solved >= rule["required"])
    completed = rule["completedTopics"]
    if passed:
        if rule["tier"] == "rare":
            completed = list(dict.fromkeys(completed + sorted(topics)))[:2]
            profile.setdefault("stickerStages", {})[key] = completed
            if len(completed) >= 2:
                award(profile, key)
        else:
            award(profile, key)
    profile["lastMission"] = dict(id=data.get("id"), key=key, passed=passed, solved=solved,
                                  required=rule["required"], completed=len(completed), stages=rule["stages"],
                                  awarded=key in profile["stickers"])
    return passed


def normalize_login(value):
    if not isinstance(value, str):
        raise ValueError("Введите логин.")
    login = unicodedata.normalize("NFKC", value).strip().casefold()
    if not 3 <= len(login) <= 32 or not all(c.isalnum() or c in "._-" for c in login):
        raise ValueError("Логин — от 3 до 32 букв, цифр, точек, дефисов или подчёркиваний.")
    return login


def validate_password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise ValueError("Пароль — от 8 до 128 символов.")
    return value


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PASSWORD_ROUNDS).hex()


def token_digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def initialize_database(database):
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, progress TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS rounds (player TEXT, id TEXT, PRIMARY KEY(player,id))")
        db.execute("CREATE TABLE IF NOT EXISTS mario_tickets (player TEXT, round TEXT, created REAL NOT NULL, used REAL, PRIMARY KEY(player,round))")
        db.execute("CREATE TABLE IF NOT EXISTS mario_sessions (player TEXT PRIMARY KEY, id TEXT NOT NULL, auth TEXT NOT NULL, expires REAL)")
        db.execute("CREATE TABLE IF NOT EXISTS accounts (player TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, digest TEXT NOT NULL, parent INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player TEXT NOT NULL, expires REAL NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS auth_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS login_attempts (scope TEXT PRIMARY KEY, failures INTEGER, updated REAL, blocked REAL)")
        if not db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone():
            setup_file = database.with_suffix(".setup-code")
            if setup_file.exists():
                code = setup_file.read_text().strip()
            else:
                code = secrets.token_urlsafe(24)
                descriptor = os.open(setup_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "w") as output:
                    output.write(code + "\n")
            db.execute("INSERT OR REPLACE INTO auth_settings VALUES ('setup',?)", (token_digest(code),))


def daily_mission():
    today = datetime.now(timezone(timedelta(hours=3))).date()
    return today.isoformat(), DAILY_MISSIONS[today.toordinal() % len(DAILY_MISSIONS)]


def reward_defaults(profile):
    profile.setdefault("coins", 0)
    profile.setdefault("reviewWins", 0)
    profile.setdefault("dailyDone", "")
    profile.setdefault("albumPages", 1)
    profile.setdefault("albumPage", 0)
    return profile


def school_classes(profile):
    saved = profile.get("schoolClasses")
    if not isinstance(saved, list):
        return [1, 2, 3, 4]
    valid = sorted({grade for grade in saved if type(grade) is int and grade in (1, 2, 3, 4)})
    return valid or [1, 2, 3, 4]


def player_view(player_id, name, avatar, profile, characters=False, catalog=False):
    day, mission = daily_mission()
    prices = dict(REWARD_PRICES)
    visible = dict(profile)
    visible["schoolClasses"] = school_classes(profile)
    hidden = set() if catalog else set(CATALOG_ONLY_STICKERS)
    if not characters:
        hidden.update(CHARACTER_STICKERS)
    prices = {key: cost for key, cost in prices.items() if key not in hidden}
    visible["stickers"] = {key: value for key, value in profile["stickers"].items() if key not in hidden}
    return dict(id=player_id, name=name, avatar=avatar, **visible,
                rewards=dict(prices=prices, day=day, mission=mission, achievementOnly=True,
                             conditions={key: mission_condition(profile, key) for key in MISSION_REWARDS if key not in hidden},
                             decorations=ALBUM_DECORATIONS))


def initial_profile():
    return reward_defaults({"preferences": {}, "rounds": 0, "correct": 0, "topics": [], "best": {}, "stickers": {}})


def award(profile, sticker):
    if sticker not in profile["stickers"]:
        profile["stickers"][sticker] = None


def apply_round(profile, data):
    score, total, topics, review = (data.get(key) for key in ("score", "total", "topics", "review"))
    corrected = data.get("corrected", 0)
    mission = data.get("mission")
    daily = data.get("daily")
    if (type(score) is not int or total not in ((10, 20, 30, 50, 100) if mission is not None else (10, 50, 100)) or not 0 <= score <= total
            or not isinstance(topics, list) or not 1 <= len(topics) <= 64
            or not all(isinstance(topic, str) and topic.isascii() and topic.isalnum()
                       and 1 <= len(topic) <= 40 for topic in topics)
            or type(review) is not bool or type(corrected) is not int or not 0 <= corrected <= total - score
            or (mission is not None and (not isinstance(mission, str) or mission not in MISSION_REWARDS or total not in (10, 20, 30) or review))
            or (daily is not None and (mission is None or not isinstance(daily, str) or len(daily) != 10))):
        raise ValueError("Некорректный результат тренировки.")
    passed = apply_mission_achievement(profile, data) if mission else False
    profile["rounds"] += 1
    profile["correct"] += score
    profile["topics"] = sorted(set(profile["topics"] + topics))[:512]
    award(profile, "start")
    if len(profile["topics"]) >= 3:
        award(profile, "books")
    if mission:
        today, offered = daily_mission()
        if passed and daily == today and mission in (offered, "koopa") and profile["dailyDone"] != today:
            profile["dailyDone"] = today
            profile["coins"] += 2
            award(profile, "coin")
        return

    profile["coins"] += 1
    award(profile, "coin")
    if review and score > 0:
        award(profile, "detective")
    if review:
        profile["reviewWins"] = min(3, profile["reviewWins"] + score + corrected)
        if profile["reviewWins"] >= 3:
            award(profile, "star")
    if len(topics) == 1:
        topic = topics[0]
        percentage = score * 100 // total
        previous = profile["best"].get(topic)
        if previous is not None and percentage > previous:
            award(profile, "rocket")
        if len(profile["best"]) < 100 or previous is not None:
            profile["best"][topic] = max(percentage, previous or 0)


def public_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or parsed.port not in (None, 443) or ':' in parsed.hostname
            or any(not (c.isascii() and (c.isalnum() or c in '.-')) for c in parsed.hostname)):
        raise ValueError('Public origin must be an HTTPS hostname without a path.')
    return 'https://' + parsed.hostname.lower()


class BunnyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, database, allowed_hosts, directory, external_origin=None, **kwargs):
        self.database = database
        self.allowed_hosts = allowed_hosts
        self.external_origin = external_origin
        super().__init__(*args, directory=directory, **kwargs)

    def list_directory(self, _path):
        self.send_error(404)
        return None

    def do_GET(self):
        if urlsplit(self.path).path.startswith("/api/"):
            self.handle_api()
        else:
            if self.static_access():
                super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path.startswith("/api/"):
            self.send_error(405)
        else:
            if self.static_access():
                super().do_HEAD()

    def static_access(self):
        if not self.external_origin:
            return True
        if not self.valid_origin():
            self.send_error(403)
            return False
        path = unquote(urlsplit(self.path).path)
        if ('\x00' in path or '\\' in path or any(p in ('.', '..') for p in path.split('/'))):
            self.send_error(404)
            return False
        code = {'/', '/index.html', '/styles.css', '/app.js', '/russian-curriculum.js', '/russian.js',
                '/school-curriculum.js', '/school.js', '/players.js', '/mario-replay.js', '/mario-manual.js'}
        root = Path(self.directory).resolve()
        target = (root / path.lstrip('/')).resolve()
        if not target.is_relative_to(root) or (path not in code and not path.startswith('/assets/')):
            self.send_error(404)
            return False
        if path.startswith('/assets/'):
            with closing(sqlite3.connect(self.database, timeout=5)) as db:
                signed_in = self.account(db)
            if not signed_in:
                self.send_error(401)
                return False
        return True

    def end_headers(self):
        if self.external_origin:
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        super().end_headers()

    def valid_origin(self):
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if len(self.headers.get_all('Host', [])) != 1 or host not in self.allowed_hosts:
            return False
        expected = self.external_origin or 'http://' + host
        if self.external_origin and self.command == 'POST' and not origin:
            return False
        return origin is None or origin == expected

    def do_POST(self):
        self.handle_api()

    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "auth_cookie", None):
            self.send_header("Set-Cookie", self.auth_cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self):
        self.auth_cookie = None
        reward_version = parse_qs(urlsplit(self.path).query).get("rewards", [""])[0]
        self.character_rewards = reward_version in ("characters", "catalog-v1")
        self.catalog_rewards = reward_version == "catalog-v1"
        if not self.valid_origin():
            self.respond(403, {"error": "Откройте игру по её настроенному адресу."})
            return
        try:
            data = None
            if self.command == "POST":
                size = int(self.headers.get("Content-Length", "0"))
                if self.headers.get_content_type() != "application/json" or not 0 < size <= 32768:
                    raise ValueError("Неверный формат запроса.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Неверный формат запроса.")
            with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
                if data is not None:
                    db.execute("BEGIN IMMEDIATE")
                status, result = self.route(db, urlsplit(self.path).path, data)
            self.respond(status, result)
        except (ValueError, UnicodeError) as error:
            self.respond(400, {"error": str(error)})
        except sqlite3.Error:
            self.respond(503, {"error": "Прогресс временно недоступен. Попробуйте ещё раз."})

    def session_token(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            return cookies["bunny_session"].value if "bunny_session" in cookies else ""
        except CookieError:
            return ""

    def account(self, db):
        token = self.session_token()
        return db.execute(
            "SELECT a.player,a.login,a.parent FROM sessions s JOIN accounts a ON a.player=s.player "
            "WHERE s.token=? AND s.expires>?", (token_digest(token), time.time())
        ).fetchone() if token else None

    def sign_in(self, db, player_id, remember):
        db.execute("DELETE FROM sessions WHERE token=? OR expires<=?", (token_digest(self.session_token()), time.time()))
        token = secrets.token_urlsafe(32)
        duration = 30 * 86400 if remember else 12 * 3600
        db.execute("INSERT INTO sessions VALUES (?,?,?)", (token_digest(token), player_id, time.time() + duration))
        self.auth_cookie = "bunny_session=" + token + "; HttpOnly; SameSite=Strict; Path=/"
        if self.external_origin:
            self.auth_cookie += '; Secure'
        if remember:
            self.auth_cookie += "; Max-Age=" + str(duration)

    def auth_status(self, db):
        account = self.account(db)
        profile = None
        if account:
            name, avatar, saved = db.execute("SELECT name,avatar,progress FROM players WHERE id=?", (account[0],)).fetchone()
            profile = player_view(account[0], name, avatar, reward_defaults(json.loads(saved)), self.character_rewards, self.catalog_rewards)
        return dict(configured=bool(db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone()),
                    player=profile, parent=bool(account and account[2]), login=account[1] if account else None)

    def auth_scope(self, action, login=""):
        address = self.client_address[0]
        # Only the loopback-only external instance trusts the last hop added by
        # its local reverse proxy. A caller-supplied prefix cannot evade limits.
        if self.external_origin and ipaddress.ip_address(address).is_loopback:
            forwarded = self.headers.get('X-Forwarded-For', '').split(',')[-1].strip()
            try:
                address = str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
        return action + ":" + address + ":" + login

    def blocked(self, db, scope):
        row = db.execute("SELECT blocked FROM login_attempts WHERE scope=?", (scope,)).fetchone()
        return bool(row and row[0] > time.time())

    def failed_login(self, db, scope):
        now = time.time()
        db.execute("DELETE FROM login_attempts WHERE updated<?", (now - 86400,))
        previous = db.execute("SELECT failures,updated FROM login_attempts WHERE scope=?", (scope,)).fetchone()
        failures = previous[0] + 1 if previous and previous[1] > now - 600 else 1
        db.execute("INSERT OR REPLACE INTO login_attempts VALUES (?,?,?,?)",
                   (scope, failures, now, now + 300 if failures >= 5 else 0))

    @staticmethod
    def account_list(db):
        return [dict(id=p, name=n, avatar=a, login=login, ready=bool(login))
                for p, n, a, login in db.execute(
                    "SELECT p.id,p.name,p.avatar,a.login FROM players p LEFT JOIN accounts a ON a.player=p.id ORDER BY p.rowid")]

    @staticmethod
    def create_player(db, data):
        name, avatar = data.get("name"), data.get("avatar")
        if not isinstance(name, str) or not isinstance(avatar, str) or avatar not in AVATARS:
            raise ValueError("Выберите аватар и введите имя.")
        name = " ".join(unicodedata.normalize("NFC", name).split())
        if not 1 <= len(name) <= 20 or any(unicodedata.category(c).startswith("C") for c in name):
            raise ValueError("Введите имя длиной от 1 до 20 символов.")
        if db.execute("SELECT count(*) FROM players").fetchone()[0] >= 12:
            raise ValueError("В игре уже 12 профилей.")
        if any(other.casefold() == name.casefold() for (other,) in db.execute("SELECT name FROM players")):
            raise ValueError("Такое имя уже есть. Выберите его в списке.")
        player_id = uuid4().hex
        db.execute("INSERT INTO players VALUES (?,?,?,?)", (player_id, name, avatar, json.dumps(initial_profile())))
        return player_id

    def save_account(self, db, data, parent=False):
        login = normalize_login(data.get("login"))
        password = validate_password(data.get("password"))
        player = data.get("player")
        if player is not None and (not isinstance(player, str) or not db.execute("SELECT 1 FROM players WHERE id=?", (player,)).fetchone()):
            raise ValueError("Выберите существующий профиль.")
        other = db.execute("SELECT player FROM accounts WHERE login=?", (login,)).fetchone()
        if other and other[0] != player:
            raise ValueError("Этот логин уже занят.")
        if player is None:
            player = self.create_player(db, data)
        salt = secrets.token_hex(16)
        digest = password_digest(password, salt)
        existing = db.execute("SELECT parent FROM accounts WHERE player=?", (player,)).fetchone()
        db.execute("INSERT OR REPLACE INTO accounts VALUES (?,?,?,?,?)",
                   (player, login, salt, digest, int(parent or bool(existing and existing[0]))))
        db.execute("DELETE FROM sessions WHERE player=?", (player,))
        return player

    def route_auth(self, db, path, data):
        if path == "/api/auth/status" and data is None:
            return 200, self.auth_status(db)
        if data is None:
            return 405, {"error": "Используйте форму входа."}
        if path == "/api/auth/logout":
            db.execute("DELETE FROM sessions WHERE token=?", (token_digest(self.session_token()),))
            self.auth_cookie = "bunny_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
            if self.external_origin:
                self.auth_cookie += '; Secure'
            return 200, {"ok": True}
        if path == "/api/auth/login":
            login = normalize_login(data.get("login"))
            password = validate_password(data.get("password"))
            scope = self.auth_scope("login", login)
            if self.blocked(db, scope) or self.blocked(db, self.auth_scope("login")):
                return 429, {"error": "Слишком много попыток. Попробуйте через 5 минут."}
            row = db.execute("SELECT player,salt,digest FROM accounts WHERE login=?", (login,)).fetchone()
            digest = password_digest(password, row[1] if row else "00" * 16)
            if not row or not hmac.compare_digest(row[2], digest):
                self.failed_login(db, scope)
                self.failed_login(db, self.auth_scope("login"))
                return 401, {"error": "Неверный логин или пароль."}
            db.execute("DELETE FROM login_attempts WHERE scope IN (?,?)", (scope, self.auth_scope("login")))
            self.sign_in(db, row[0], data.get("remember") is True)
            # The new cookie is sent with the response and is not in the request yet.
            return 200, {"ok": True}
        if path == "/api/auth/setup":
            if self.external_origin:
                return 403, {"error": "Первоначальная настройка выполняется в домашней сети."}
            if db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone():
                return 409, {"error": "Родительский доступ уже настроен. Войдите с паролем."}
            scope = self.auth_scope("setup")
            if self.blocked(db, scope):
                return 429, {"error": "Слишком много попыток. Попробуйте через 5 минут."}
            row = db.execute("SELECT value FROM auth_settings WHERE key='setup'").fetchone()
            code = data.get("code")
            if not row or not isinstance(code, str) or not hmac.compare_digest(row[0], token_digest(code.strip())):
                self.failed_login(db, scope)
                return 403, {"error": "Неверный код первоначальной настройки."}
            player = self.save_account(db, data, parent=True)
            db.execute("DELETE FROM auth_settings WHERE key='setup'")
            self.sign_in(db, player, data.get("remember") is True)
            return 200, {"ok": True}
        if path == "/api/auth/accounts":
            account = self.account(db)
            if not account or not account[2]:
                return 403, {"error": "Войдите в родительский профиль."}
            self.save_account(db, data)
            return 200, {"ok": True}
        return 404, {"error": "Страница не найдена."}

    def route(self, db, path, data):
        if path.startswith("/api/auth/"):
            return self.route_auth(db, path, data)
        if path == "/api/mario":
            return self.route_mario(db, data)
        if path == "/api/players":
            if data is None:
                accounts = self.account_list(db)
                current = self.account(db)
                if self.external_origin and not current:
                    return 200, []
                setup = not db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone()
                return 200, accounts if setup or (current and current[2]) else [item for item in accounts if item["ready"]]
            return 403, {"error": "Создавайте игроков в родительском кабинете."}

        parts = path.split("/")
        if len(parts) != 4 or parts[1:3] != ["api", "players"]:
            return 404, {"error": "Страница не найдена."}
        player_id = parts[3]
        account = self.account(db)
        if not account:
            return 401, {"error": "Войдите в свой профиль."}
        if account[0] != player_id:
            return 403, {"error": "Этот прогресс принадлежит другому игроку."}
        row = db.execute("SELECT name,avatar,progress FROM players WHERE id=?", (player_id,)).fetchone()
        if row is None:
            return 404, {"error": "Игрок не найден."}
        name, avatar, saved = row
        profile = reward_defaults(json.loads(saved))
        if data is not None:
            self.update(db, player_id, profile, data)
            db.execute("UPDATE players SET progress=? WHERE id=?", (json.dumps(profile), player_id))
        return 200, player_view(player_id, name, avatar, profile, getattr(self, "character_rewards", False), getattr(self, "catalog_rewards", False))

    def route_mario(self, db, data):
        account = self.account(db)
        if not account:
            return 401, {"error": "Войдите в свой профиль."}
        player, _login, parent = account
        now = time.time()
        auth = token_digest(self.session_token())
        session = db.execute("SELECT id,auth,expires FROM mario_sessions WHERE player=?", (player,)).fetchone()
        valid = bool(session and (session[2] is None and parent or session[2] is not None and session[2] > now))
        action = data.get("action") if data is not None else None
        if action == "start":
            if not valid:
                if not parent:
                    ticket = db.execute("SELECT round FROM mario_tickets WHERE player=? AND used IS NULL ORDER BY created,round LIMIT 1", (player,)).fetchone()
                    if not ticket:
                        return 403, {"error": "Сначала полностью заверши учебный раунд — получишь 10 минут Марио."}
                    db.execute("UPDATE mario_tickets SET used=? WHERE player=? AND round=?", (now, player, ticket[0]))
                session = (secrets.token_urlsafe(24), auth, None if parent else now + 600)
                db.execute("INSERT OR REPLACE INTO mario_sessions VALUES (?,?,?,?)", (player, *session))
            elif session[1] != auth:
                # Transfer an earned session to another signed-in device without extending it.
                session = (secrets.token_urlsafe(24), auth, session[2])
                db.execute("INSERT OR REPLACE INTO mario_sessions VALUES (?,?,?,?)", (player, *session))
            valid = True
        elif action == "heartbeat":
            if not valid or session[1] != auth or not isinstance(data.get("id"), str) or not hmac.compare_digest(session[0], data["id"]):
                return 403, {"error": "Время игры закончилось. Заверши ещё один учебный раунд."}
        elif data is not None:
            raise ValueError("Неизвестное действие Марио.")
        tickets = db.execute("SELECT count(*) FROM mario_tickets WHERE player=? AND used IS NULL", (player,)).fetchone()[0]
        result = dict(admin=bool(parent), tickets=tickets, canResume=valid, serverTime=now)
        if valid and session[1] == auth:
            result.update(id=session[0], expires=session[2], remaining=None if session[2] is None else max(0, session[2]-now))
        return 200, result

    @staticmethod
    def update(db, player_id, profile, data):
        kind = data.get("kind")
        if kind == "preference":
            key, value = data.get("key"), data.get("value")
            if not isinstance(key, str) or key not in PREFERENCES or not isinstance(value, str) or len(value) > 8000:
                raise ValueError("Некорректная настройка.")
            if (key == "bunny-russian-class" or (key.startswith("bunny-school-") and key.endswith("-class"))) and value not in [str(grade) for grade in school_classes(profile)]:
                raise ValueError("Этот класс не выбран для игрока.")
            if key.startswith("bunny-school-") and key.endswith("-class") and value not in ("2", "4"):
                raise ValueError("Учебники доступны для 2-го и 4-го классов.")
            profile["preferences"][key] = value
        elif kind == "round":
            operation = data.get("id")
            if not isinstance(operation, str) or len(operation) != 36 or str(UUID(operation)) != operation:
                raise ValueError("Некорректный номер раунда.")
            inserted = db.execute("INSERT OR IGNORE INTO rounds VALUES (?, ?)", (player_id, operation)).rowcount
            if inserted:
                apply_round(profile, data)
                db.execute("INSERT INTO mario_tickets (player,round,created) VALUES (?,?,?)", (player_id, operation, time.time()))
        elif kind == "sticker":
            sticker, x, y = (data.get(key) for key in ("sticker", "x", "y"))
            if not isinstance(sticker, str) or sticker not in profile["stickers"]:
                raise ValueError("Выберите полученную наклейку.")
            if data.get("placed") is False:
                profile["stickers"][sticker] = None
                return
            if not all(
                type(value) in (int, float) and 0 <= value <= 100 and math.isfinite(value) for value in (x, y)
            ):
                raise ValueError("Выберите полученную наклейку и место на странице.")
            # Older tabs send only x/y; retain new layout fields when they move a sticker.
            point = dict(profile["stickers"][sticker] or {})
            if data.get("boardReset") is True:
                point.pop("boardX", None)
                point.pop("boardY", None)
            for key, low, high in (("boardX", 80, 1520), ("boardY", 80, 1520),
                                   ("page", 0, profile.get("albumPages", 1) - 1),
                                   ("scale", 0.65, 1.5), ("rotation", -30, 30)):
                if key not in data:
                    continue
                value = data[key]
                if (type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high
                        or (key == "page" and type(value) is not int)):
                    raise ValueError("Некорректное оформление наклейки.")
                point[key] = value if key == "page" else round(value, 2)
            point.update(x=round(x, 2), y=round(y, 2))
            profile["stickers"][sticker] = point
        elif kind == "album-page":
            pages, page = data.get("pages"), data.get("page")
            if (type(pages) is not int or type(page) is not int or not 1 <= pages <= 12
                    or not 0 <= page < pages):
                raise ValueError("Выберите страницу альбома.")
            # Retried/offline events must never remove pages added from another device.
            profile["albumPages"] = max(profile.get("albumPages", 1), pages)
            profile["albumPage"] = page
        elif kind == "album-view":
            x, y = data.get("x"), data.get("y")
            if not all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1600
                       for value in (x, y)):
                raise ValueError("Некорректное положение альбома.")
            view = {"x": round(x, 2), "y": round(y, 2)}
            if "zoom" in data:
                zoom = data["zoom"]
                if type(zoom) not in (int, float) or not math.isfinite(zoom) or not 0.5 <= zoom <= 2:
                    raise ValueError("Масштаб альбома — от 50% до 200%.")
                view["zoom"] = round(zoom, 4)
            elif "zoom" in (profile.get("albumView") or {}):
                view["zoom"] = profile["albumView"]["zoom"]
            profile["albumView"] = view
        elif kind == "redeem":
            sticker = data.get("sticker")
            if not isinstance(sticker, str) or sticker not in REWARD_PRICES:
                raise ValueError("Выберите наклейку из коллекции.")
            # Old queued exchange requests are harmless no-ops; do not debit coins.
            return
        elif kind == "album-decoration":
            key = data.get("decoration")
            if key != "default" and key not in ALBUM_DECORATIONS:
                raise ValueError("Выберите оформление альбома.")
            owned = set(profile.get("albumDecorations", []))
            if key != "default" and key not in owned:
                cost = ALBUM_DECORATIONS[key]["cost"]
                if profile["coins"] < cost:
                    return  # A stale tab must not leave an unpayable event blocking its queue.
                profile["coins"] -= cost
                owned.add(key)
                profile["albumDecorations"] = sorted(owned)
            profile["albumDecoration"] = key
        else:
            raise ValueError("Неизвестное действие.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8097, type=int)
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument('--public-origin', help='HTTPS origin for a separate loopback-only tunnel listener')
    options = parser.parse_args()
    if options.database.resolve().is_relative_to(options.directory.resolve()):
        parser.error("The database must be outside the web directory.")
    options.database.parent.mkdir(parents=True, exist_ok=True)
    initialize_database(options.database)
    allowed_hosts = {f"{host}:{options.port}" for host in ["127.0.0.1", "localhost", *options.host]}
    external_origin = None
    if options.public_origin:
        if options.bind != '127.0.0.1':
            parser.error('The public tunnel listener must bind to 127.0.0.1.')
        try:
            external_origin = public_origin(options.public_origin)
        except ValueError as error:
            parser.error(str(error))
        allowed_hosts = {urlsplit(external_origin).netloc}
        with closing(sqlite3.connect(options.database)) as db:
            if not db.execute('SELECT 1 FROM accounts WHERE parent=1').fetchone():
                parser.error('Configure the parent account through the home listener first.')
    handler = partial(BunnyHandler, database=options.database, directory=options.directory,
                      allowed_hosts=allowed_hosts, external_origin=external_origin)
    with ThreadingHTTPServer((options.bind, options.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
