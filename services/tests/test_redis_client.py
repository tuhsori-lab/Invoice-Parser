from invoice_service import jobs


def test_blocking_reads_are_not_cut_off_by_a_default_socket_timeout():
    # redis-py 8 defaults to a 5 s read timeout, which broke every longer wait.
    client = jobs.connect("redis://127.0.0.1:6379/0")
    kwargs = client.connection_pool.connection_kwargs
    assert kwargs.get("socket_timeout") is None
    assert kwargs.get("socket_connect_timeout") == 5
