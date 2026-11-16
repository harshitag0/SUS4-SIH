import datetime
from datetime import timezone
import pymongo

client = pymongo.MongoClient("mongodb://127.0.0.1:27017")
m2 = client["agrilink_m2"]
m1 = client["agrilink"]

now = datetime.datetime(2027, 4, 14, 3, 30, tzinfo=timezone.utc)

# 1. Sync buyers and farmers from Module 1 into Module 2
m1_users = list(m1.users.find())
m1_buyers = [u for u in m1_users if u.get("role") == "buyer"]
m1_farmers = [u for u in m1_users if u.get("role") == "farmer"]

for b in m1_buyers:
    bid = f"AGL-B-{b['_id']}"
    m2.buyers.update_one(
        {"_id": bid},
        {"$set": {"name": b.get("company", b.get("name")), "country": "SG", "source": "agrilink"}},
        upsert=True
    )
    # Also add buyer ratings for March and April 2027
    for period in ["2027-03", "2027-04"]:
        m2.rating_snapshots.update_one(
            {"subject_type": "buyer", "subject_id": bid, "period": period},
            {"$set": {
                "subject_type": "buyer",
                "subject_id": bid,
                "period": period,
                "name": b.get("company", b.get("name")),
                "rating": 4.9,
                "month_score": 4.95,
                "is_new": False,
                "components": {
                    "on_time_payment": 1.0,
                    "order_commitment": 1.0,
                    "fair_grading": 1.0,
                    "responsiveness": 0.95,
                    "farmer_review": 0.98,
                },
                "computed_at": now,
            }},
            upsert=True
        )

# Also ensure BUY-A and BUY-B have rating snapshots
for bid, name, score in [("BUY-A", "Singapore Supermarket Group A", 4.8), ("BUY-B", "Singapore Supermarket Group B", 4.7)]:
    for period in ["2027-03", "2027-04"]:
        m2.rating_snapshots.update_one(
            {"subject_type": "buyer", "subject_id": bid, "period": period},
            {"$set": {
                "subject_type": "buyer",
                "subject_id": bid,
                "period": period,
                "name": name,
                "rating": score,
                "month_score": score + 0.1,
                "is_new": False,
                "components": {
                    "on_time_payment": 1.0,
                    "order_commitment": 0.95,
                    "fair_grading": 1.0,
                    "responsiveness": 0.92,
                    "farmer_review": 0.95,
                },
                "computed_at": now,
            }},
            upsert=True
        )

# 2. Add realistic recovery request in Module 2
m2.recovery_requests.delete_many({})
rec_id = "REC-2027-001"
recovery_doc = {
    "_id": rec_id,
    "id": rec_id,
    "agreement_id": "AGR-2027-001",
    "alert_id": "ALT-2027-001",
    "reason": "Heat wave shortfall in Ratnagiri coastal belt (40°C unseasonal spike)",
    "affected_areas": ["Ratnagiri"],
    "shortfall_kg": 1500.0,
    "filled_kg": 1000.0,
    "ranking_mode": "first_come_first_served",
    "candidates": [
        {
            "rank": 1,
            "fpo_id": "FPO-DVG",
            "name": "Devgad Taluka Mango Growers Co-op",
            "taluka": "Devgad",
            "spare_capacity_kg": 3500.0,
            "rating": 4.85,
            "is_new": False,
            "reason": "Outside heat wave zone · 3,500 kg spare verified"
        },
        {
            "rank": 2,
            "fpo_id": "FPO-SDK",
            "name": "Sindhudurg Organic Alphonso Society",
            "taluka": "Kudal",
            "spare_capacity_kg": 2000.0,
            "rating": 4.70,
            "is_new": True,
            "reason": "20% new-FPO reserve · GI certified"
        }
    ],
    "offers": [
        {
            "fpo_id": "FPO-DVG",
            "fpo_name": "Devgad Taluka Mango Growers Co-op",
            "kg": 1000.0,
            "status": "ACCEPTED",
            "offered_at": datetime.datetime(2027, 4, 12, 11, 0, tzinfo=timezone.utc),
            "decided_at": datetime.datetime(2027, 4, 12, 14, 30, tzinfo=timezone.utc),
            "note": "Allocated 1,000 kg Grade A Alphonso from Vijaydurg cluster"
        },
        {
            "fpo_id": "FPO-SDK",
            "fpo_name": "Sindhudurg Organic Alphonso Society",
            "kg": 500.0,
            "status": "OFFERED",
            "offered_at": datetime.datetime(2027, 4, 13, 9, 15, tzinfo=timezone.utc),
            "note": "Awaiting physical paper signatures from 2 farmers"
        }
    ],
    "status": "PARTIAL",
    "created_at": datetime.datetime(2027, 4, 12, 10, 0, tzinfo=timezone.utc),
    "created_by": "OPS-1"
}
m2.recovery_requests.insert_one(recovery_doc)

print("Module 2 seeded with buyer ratings and active recovery request!")
